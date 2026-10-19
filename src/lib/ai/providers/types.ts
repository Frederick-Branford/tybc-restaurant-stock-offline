// Shared result and error types for the local AI provider (Ollama).
// Deliberately small: this is not a generic AI provider abstraction.

import type { ValidatedLocalAiOutput } from "@/lib/ai/local/validate";

export const LOCAL_AI_ERROR_CODES = [
  "LOCAL_AI_DISABLED",
  "LOCAL_AI_CONFIGURATION_ERROR",
  "LOCAL_AI_BUSY",
  "OLLAMA_UNREACHABLE",
  "OLLAMA_TIMEOUT",
  "OLLAMA_REQUEST_FAILED",
  "INVALID_MODEL_OUTPUT",
] as const;

export type LocalAiErrorCode =
  (typeof LOCAL_AI_ERROR_CODES)[number];

// Fixed, non-sensitive detail codes. They never contain prompt, digest,
// model text, URLs or stack traces.
export type LocalAiErrorReason =
  // LOCAL_AI_DISABLED
  | "NOT_ENABLED"
  | "VERCEL_RUNTIME"
  // LOCAL_AI_CONFIGURATION_ERROR
  | "INVALID_BASE_URL"
  | "BASE_URL_PROTOCOL"
  | "BASE_URL_CREDENTIALS"
  | "BASE_URL_PATH"
  | "NON_LOOPBACK_HOST"
  | "INVALID_MODEL"
  | "INVALID_TIMEOUT"
  | "INVALID_KEEP_ALIVE"
  // LOCAL_AI_BUSY
  | "REQUEST_IN_FLIGHT"
  // OLLAMA_UNREACHABLE
  | "CONNECTION_FAILED"
  // OLLAMA_TIMEOUT
  | "TIMEOUT"
  // OLLAMA_REQUEST_FAILED
  | "HTTP_ERROR"
  | "INVALID_RESPONSE"
  // INVALID_MODEL_OUTPUT
  | "NOT_DONE"
  | "TRUNCATED"
  | "UNEXPECTED_DONE_REASON"
  | "OUTPUT_LIMIT_REACHED"
  | "CONTEXT_BUDGET_EXCEEDED"
  | "CONTEXT_UNVERIFIABLE"
  | "EMPTY_CONTENT"
  | "INVALID_JSON"
  | "SCHEMA_INVALID";

export type LocalAiError = {
  code: LocalAiErrorCode;
  reason: LocalAiErrorReason;
  // Only for HTTP_ERROR: the status Ollama returned.
  http_status?: number;
};

// Taken from the Ollama response, never from model text.
export type LocalAiRunMetadata = {
  provider: "ollama";
  model: string;
  done_reason: string | null;
  total_duration_ms: number | null;
  load_duration_ms: number | null;
  prompt_eval_count: number | null;
  eval_count: number | null;
};

export type LocalAiResult =
  | {
      ok: true;
      output: ValidatedLocalAiOutput;
      meta: LocalAiRunMetadata;
    }
  | {
      ok: false;
      error: LocalAiError;
      meta: LocalAiRunMetadata | null;
    };
