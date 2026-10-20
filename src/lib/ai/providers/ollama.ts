import "server-only";

import { z } from "zod";

import {
  localDigestSchema,
  type LocalDigest,
} from "@/lib/ai/local/digest";

import {
  buildLocalAiMessages,
  type LocalAiMessage,
} from "@/lib/ai/local/prompt";

import { localAiOutputJsonSchema } from "@/lib/ai/local/schema";

import { validateLocalAiOutput } from "@/lib/ai/local/validate";

import type {
  LocalAiError,
  LocalAiErrorCode,
  LocalAiErrorReason,
  LocalAiResult,
  LocalAiRunMetadata,
} from "@/lib/ai/providers/types";

// Local AI provider: one Ollama chat call on the notebook that runs this
// Next.js server.
//
// - Server-only. Disabled unless AI_LOCAL_ENABLED=true, and always disabled
//   on Vercel (a Vercel server cannot reach a notebook's loopback).
// - Talks only to a loopback Ollama (127.0.0.1 or [::1]) over HTTP, with
//   redirects refused, so restaurant data never leaves the machine.
// - Sends only the Phase 2 LocalDigest and prompt. No tools, no streaming,
//   no thinking, no writes.
// - Never returns model JSON unless it passed the Phase 2 Zod schema and
//   semantic validation against the same digest.
// - One inference at a time per Node process; extra calls fail fast.
// - Logs nothing. Metadata comes from the Ollama response.
//
// It never starts Ollama, pulls models or manages services.

// ============================================================
// Configuration
// ============================================================

// Calibrated on the target CPU-only notebook (qwen3.5:4b): a first run
// with num_predict 256 was truncated (done_reason "length") after ~63 s
// including a ~13 s model load. num_predict is raised to 320 and the
// default timeout to 120 s. If 320 is still reached, output verbosity is
// reduced instead of raising num_predict again.
export const OLLAMA_DEFAULTS = {
  baseUrl: "http://127.0.0.1:11434",
  model: "qwen3.5:4b",
  timeoutMs: 120_000,
  keepAlive: "10m",
} as const;

export const OLLAMA_MODEL_OPTIONS = {
  temperature: 0,
  num_ctx: 2048,
  num_predict: 320,
} as const;

// The prompt must leave the whole output budget free inside num_ctx:
// 2048 - 320 = 1728 tokens.
export const OLLAMA_PROMPT_TOKEN_BUDGET =
  OLLAMA_MODEL_OPTIONS.num_ctx -
  OLLAMA_MODEL_OPTIONS.num_predict;

const TIMEOUT_MIN_MS = 1_000;
const TIMEOUT_MAX_MS = 300_000;
const KEEP_ALIVE_MAX_SECONDS = 24 * 60 * 60;

// Ollama model references such as "qwen3.5:4b" or "namespace/model:tag".
const MODEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;

// Positive durations only ("30s", "10m", "1h"). "0" (unload at once) and
// negative values (keep forever) are rejected.
const KEEP_ALIVE_PATTERN = /^([1-9][0-9]{0,4})(s|m|h)$/;

const KEEP_ALIVE_UNIT_SECONDS: Record<string, number> = {
  s: 1,
  m: 60,
  h: 3600,
};

// Literal loopback addresses only. "localhost" is rejected: it depends on
// name resolution and may resolve to ::1 while Ollama listens on 127.0.0.1.
const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "[::1]"]);
const OFFLINE_CONTAINER_HOSTNAME = "ollama";
const OLLAMA_DEFAULT_PORT = "11434";

function isAllowedOllamaHost(
  url: URL,
  env: LocalAiEnv,
): boolean {
  if (LOOPBACK_HOSTNAMES.has(url.hostname)) {
    return true;
  }

  return (
    env.TYBC_OFFLINE_CONTAINER === "true" &&
    url.hostname === OFFLINE_CONTAINER_HOSTNAME &&
    url.port === OLLAMA_DEFAULT_PORT
  );
}

export type LocalAiEnv = Readonly<
  Record<string, string | undefined>
>;

export type LocalAiConfig = {
  baseUrl: string;
  chatUrl: string;
  model: string;
  timeoutMs: number;
  keepAlive: string;
};

export type LocalAiConfigResult =
  | { ok: true; config: LocalAiConfig }
  | { ok: false; error: LocalAiError };

function configFailure(
  code: LocalAiErrorCode,
  reason: LocalAiErrorReason,
): LocalAiConfigResult {
  return { ok: false, error: { code, reason } };
}

function setting(
  value: string | undefined,
  fallback: string,
): string {
  const trimmed = value?.trim();

  return trimmed ? trimmed : fallback;
}

/**
 * Reads Local AI configuration from server environment variables only:
 * VERCEL, AI_LOCAL_ENABLED, OLLAMA_BASE_URL, OLLAMA_MODEL,
 * OLLAMA_TIMEOUT_MS, OLLAMA_KEEP_ALIVE. NEXT_PUBLIC_* is never read.
 */
export function readLocalAiConfig(
  env: LocalAiEnv = process.env,
): LocalAiConfigResult {
  if (env.VERCEL !== undefined) {
    return configFailure(
      "LOCAL_AI_DISABLED",
      "VERCEL_RUNTIME",
    );
  }

  if (env.AI_LOCAL_ENABLED !== "true") {
    return configFailure(
      "LOCAL_AI_DISABLED",
      "NOT_ENABLED",
    );
  }

  let url: URL;

  try {
    url = new URL(
      setting(env.OLLAMA_BASE_URL, OLLAMA_DEFAULTS.baseUrl),
    );
  } catch {
    return configFailure(
      "LOCAL_AI_CONFIGURATION_ERROR",
      "INVALID_BASE_URL",
    );
  }

  if (url.protocol !== "http:") {
    return configFailure(
      "LOCAL_AI_CONFIGURATION_ERROR",
      "BASE_URL_PROTOCOL",
    );
  }

  if (url.username !== "" || url.password !== "") {
    return configFailure(
      "LOCAL_AI_CONFIGURATION_ERROR",
      "BASE_URL_CREDENTIALS",
    );
  }

  if (
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    return configFailure(
      "LOCAL_AI_CONFIGURATION_ERROR",
      "BASE_URL_PATH",
    );
  }

  if (!isAllowedOllamaHost(url, env)) {
    return configFailure(
      "LOCAL_AI_CONFIGURATION_ERROR",
      "NON_LOOPBACK_HOST",
    );
  }

  const model = setting(
    env.OLLAMA_MODEL,
    OLLAMA_DEFAULTS.model,
  );

  if (!MODEL_PATTERN.test(model)) {
    return configFailure(
      "LOCAL_AI_CONFIGURATION_ERROR",
      "INVALID_MODEL",
    );
  }

  const rawTimeout = setting(
    env.OLLAMA_TIMEOUT_MS,
    String(OLLAMA_DEFAULTS.timeoutMs),
  );

  const timeoutMs = /^[0-9]{1,7}$/.test(rawTimeout)
    ? Number(rawTimeout)
    : Number.NaN;

  if (
    !(timeoutMs >= TIMEOUT_MIN_MS && timeoutMs <= TIMEOUT_MAX_MS)
  ) {
    return configFailure(
      "LOCAL_AI_CONFIGURATION_ERROR",
      "INVALID_TIMEOUT",
    );
  }

  const keepAlive = setting(
    env.OLLAMA_KEEP_ALIVE,
    OLLAMA_DEFAULTS.keepAlive,
  );

  const keepAliveMatch = KEEP_ALIVE_PATTERN.exec(keepAlive);

  if (
    !keepAliveMatch ||
    Number(keepAliveMatch[1]) *
      KEEP_ALIVE_UNIT_SECONDS[keepAliveMatch[2]] >
      KEEP_ALIVE_MAX_SECONDS
  ) {
    return configFailure(
      "LOCAL_AI_CONFIGURATION_ERROR",
      "INVALID_KEEP_ALIVE",
    );
  }

  return {
    ok: true,
    config: {
      baseUrl: url.origin,
      chatUrl: new URL("/api/chat", url.origin).href,
      model,
      timeoutMs,
      keepAlive,
    },
  };
}

// ============================================================
// Request
// ============================================================

type JsonSchemaNode = { [key: string]: unknown };

function schemaNode(
  value: unknown,
  path: string,
): JsonSchemaNode {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    throw new Error(
      `Unexpected Local AI output JSON Schema shape at ${path}.`,
    );
  }

  return value as JsonSchemaNode;
}

/**
 * JSON Schema `pattern` for generated text (overview, attention[].note,
 * actions[]) in the request schema:
 * - no ASCII digits 0-9 and no Thai digits ๐-๙;
 * - no quote, backslash or control characters, so a grammar built from the
 *   pattern can only produce a valid JSON string without escapes;
 * - the same 1..max length as the Zod schema, because some
 *   schema-to-grammar converters ignore minLength/maxLength once a pattern
 *   is present.
 * Not applied to attention[].sku: real SKUs may contain digits (MILK-1L).
 * Defense in depth only: the semantic validator remains authoritative and
 * also catches digits from other scripts.
 */
export function generatedTextPattern(maxChars: number): string {
  return `^[^0-9๐-๙"\\\\\\x00-\\x1F]{1,${maxChars}}$`;
}

function restrictGeneratedText(
  node: JsonSchemaNode,
  path: string,
): void {
  if (typeof node.maxLength !== "number") {
    throw new Error(
      `Unexpected Local AI output JSON Schema shape at ${path}.`,
    );
  }

  node.pattern = generatedTextPattern(node.maxLength);
}

/**
 * Request-specific copy of the Phase 2 output JSON Schema:
 * - attention[].sku may only be a SKU from this digest; with no digest
 *   items, attention is limited to zero entries (an empty enum is never
 *   emitted);
 * - overview, attention[].note and actions[] get a no-digit pattern.
 * The shared Phase 2 schema object is never modified. Zod and semantic
 * validation still run on the response; this is defense in depth.
 */
export function buildOllamaFormatSchema(
  digestInput: LocalDigest,
): JsonSchemaNode {
  const digest = localDigestSchema.parse(digestInput);

  const schema = schemaNode(
    structuredClone(localAiOutputJsonSchema),
    "(root)",
  );

  const properties = schemaNode(
    schema.properties,
    "properties",
  );

  const attention = schemaNode(
    properties.attention,
    "properties.attention",
  );

  const itemProperties = schemaNode(
    schemaNode(attention.items, "attention.items")
      .properties,
    "attention.items.properties",
  );

  const skus = [
    ...new Set(digest.items.map((item) => item.sku)),
  ];

  if (skus.length === 0) {
    attention.maxItems = 0;
  } else {
    itemProperties.sku = {
      type: "string",
      enum: skus,
    };
  }

  restrictGeneratedText(
    schemaNode(properties.overview, "properties.overview"),
    "properties.overview",
  );

  restrictGeneratedText(
    schemaNode(itemProperties.note, "attention.items.properties.note"),
    "attention.items.properties.note",
  );

  restrictGeneratedText(
    schemaNode(
      schemaNode(properties.actions, "properties.actions").items,
      "actions.items",
    ),
    "actions.items",
  );

  return schema;
}

export type OllamaChatRequest = {
  model: string;
  messages: LocalAiMessage[];
  stream: false;
  think: false;
  format: JsonSchemaNode;
  keep_alive: string;
  options: {
    temperature: number;
    num_ctx: number;
    num_predict: number;
  };
};

export function buildOllamaChatRequest(
  digest: LocalDigest,
  config: Pick<LocalAiConfig, "model" | "keepAlive">,
): OllamaChatRequest {
  return {
    model: config.model,
    messages: buildLocalAiMessages(digest),
    stream: false,
    think: false,
    format: buildOllamaFormatSchema(digest),
    keep_alive: config.keepAlive,
    options: { ...OLLAMA_MODEL_OPTIONS },
  };
}

// ============================================================
// Response
// ============================================================

const ollamaChatResponseSchema = z.object({
  model: z.string(),
  message: z.object({
    role: z.literal("assistant"),
    content: z.string(),
  }),
  done: z.boolean(),
  done_reason: z.string().optional(),
  total_duration: z.number().nonnegative().optional(),
  load_duration: z.number().nonnegative().optional(),
  prompt_eval_count: z
    .number()
    .int()
    .nonnegative()
    .optional(),
  eval_count: z.number().int().nonnegative().optional(),
});

type OllamaChatResponse = z.infer<
  typeof ollamaChatResponseSchema
>;

function nanosecondsToMs(
  value: number | undefined,
): number | null {
  return value === undefined
    ? null
    : Math.round(value / 1_000_000);
}

function toMetadata(
  response: OllamaChatResponse,
): LocalAiRunMetadata {
  return {
    provider: "ollama",
    model: response.model,
    done_reason: response.done_reason ?? null,
    total_duration_ms: nanosecondsToMs(
      response.total_duration,
    ),
    load_duration_ms: nanosecondsToMs(
      response.load_duration,
    ),
    prompt_eval_count: response.prompt_eval_count ?? null,
    eval_count: response.eval_count ?? null,
  };
}

function failure(
  code: LocalAiErrorCode,
  reason: LocalAiErrorReason,
  meta: LocalAiRunMetadata | null = null,
): LocalAiResult {
  return { ok: false, error: { code, reason }, meta };
}

/**
 * Turns an Ollama /api/chat response body into a validated result.
 *
 * Completion and context checks (all from Ollama's own metadata):
 * - done must be true and done_reason must be "stop";
 *   "length" means truncated output;
 * - prompt_eval_count and eval_count must be present;
 * - eval_count must stay below num_predict (reaching it means the output
 *   was probably cut off);
 * - prompt_eval_count must stay below num_ctx - num_predict, so the
 *   prompt left the full output budget free and was not truncated to fit;
 * - prompt_eval_count + eval_count must not exceed num_ctx.
 */
function interpretChatResponse(
  bodyText: string,
  digest: LocalDigest,
): LocalAiResult {
  let body: unknown;

  try {
    body = JSON.parse(bodyText);
  } catch {
    return failure(
      "OLLAMA_REQUEST_FAILED",
      "INVALID_RESPONSE",
    );
  }

  const envelope = ollamaChatResponseSchema.safeParse(body);

  if (!envelope.success) {
    return failure(
      "OLLAMA_REQUEST_FAILED",
      "INVALID_RESPONSE",
    );
  }

  const response = envelope.data;
  const meta = toMetadata(response);

  const invalid = (reason: LocalAiErrorReason) =>
    failure("INVALID_MODEL_OUTPUT", reason, meta);

  if (!response.done) {
    return invalid("NOT_DONE");
  }

  if (response.done_reason === "length") {
    return invalid("TRUNCATED");
  }

  if (response.done_reason !== "stop") {
    return invalid("UNEXPECTED_DONE_REASON");
  }

  const promptTokens = response.prompt_eval_count;
  const outputTokens = response.eval_count;

  if (
    promptTokens === undefined ||
    outputTokens === undefined
  ) {
    return invalid("CONTEXT_UNVERIFIABLE");
  }

  if (outputTokens >= OLLAMA_MODEL_OPTIONS.num_predict) {
    return invalid("OUTPUT_LIMIT_REACHED");
  }

  if (
    promptTokens >= OLLAMA_PROMPT_TOKEN_BUDGET ||
    promptTokens + outputTokens >
      OLLAMA_MODEL_OPTIONS.num_ctx
  ) {
    return invalid("CONTEXT_BUDGET_EXCEEDED");
  }

  const content = response.message.content.trim();

  if (content.length === 0) {
    return invalid("EMPTY_CONTENT");
  }

  let output: unknown;

  try {
    output = JSON.parse(content);
  } catch {
    return invalid("INVALID_JSON");
  }

  const validation = validateLocalAiOutput({
    output,
    digest,
  });

  if (!validation.ok) {
    return invalid("SCHEMA_INVALID");
  }

  return { ok: true, output: validation.value, meta };
}

// ============================================================
// Call
// ============================================================

let inFlight = false;

export function isLocalAiInFlight(): boolean {
  return inFlight;
}

async function postChat(
  request: OllamaChatRequest,
  digest: LocalDigest,
  config: LocalAiConfig,
): Promise<LocalAiResult> {
  const controller = new AbortController();

  let timedOut = false;

  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, config.timeoutMs);

  try {
    let response: Response;

    try {
      response = await fetch(config.chatUrl, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(request),
        signal: controller.signal,
        // Never follow a redirect away from loopback.
        redirect: "error",
        cache: "no-store",
      });
    } catch {
      return timedOut
        ? failure("OLLAMA_TIMEOUT", "TIMEOUT")
        : failure(
            "OLLAMA_UNREACHABLE",
            "CONNECTION_FAILED",
          );
    }

    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);

      return {
        ok: false,
        error: {
          code: "OLLAMA_REQUEST_FAILED",
          reason: "HTTP_ERROR",
          http_status: response.status,
        },
        meta: null,
      };
    }

    let bodyText: string;

    try {
      bodyText = await response.text();
    } catch {
      return timedOut
        ? failure("OLLAMA_TIMEOUT", "TIMEOUT")
        : failure(
            "OLLAMA_REQUEST_FAILED",
            "INVALID_RESPONSE",
          );
    }

    return interpretChatResponse(bodyText, digest);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Runs one local inference for a Phase 2 LocalDigest and returns either
 * validated output or a typed error. Never throws for runtime failures;
 * throws only if `digest` is not a valid LocalDigest (a programming error),
 * before any lock is taken or request is sent.
 */
export async function generateLocalAiSummary(
  digest: LocalDigest,
  options: { env?: LocalAiEnv } = {},
): Promise<LocalAiResult> {
  const configResult = readLocalAiConfig(
    options.env ?? process.env,
  );

  if (!configResult.ok) {
    return {
      ok: false,
      error: configResult.error,
      meta: null,
    };
  }

  const validDigest = localDigestSchema.parse(digest);

  const request = buildOllamaChatRequest(
    validDigest,
    configResult.config,
  );

  // Checked and set synchronously, before the first await.
  if (inFlight) {
    return failure("LOCAL_AI_BUSY", "REQUEST_IN_FLIGHT");
  }

  inFlight = true;

  try {
    return await postChat(
      request,
      validDigest,
      configResult.config,
    );
  } finally {
    inFlight = false;
  }
}
