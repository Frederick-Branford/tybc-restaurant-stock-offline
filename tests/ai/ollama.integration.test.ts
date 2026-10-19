import { afterAll, describe, expect, it, vi } from "vitest";

import {
  buildLocalDigest,
  type LocalDigest,
} from "@/lib/ai/local/digest";

import {
  generateLocalAiSummary,
  OLLAMA_DEFAULTS,
  OLLAMA_MODEL_OPTIONS,
  OLLAMA_PROMPT_TOKEN_BUDGET,
} from "@/lib/ai/providers/ollama";

import type { LocalAiResult } from "@/lib/ai/providers/types";

import { snapshotFor } from "./support/local-fixtures";

// OPT-IN integration test against the real local Ollama.
// Skipped unless OLLAMA_INTEGRATION=1. It needs Ollama already running on
// http://127.0.0.1:11434 with qwen3.5:4b pulled. It uses a fixed digest
// fixture only: no Supabase, no business data, no secrets.
//
// It runs the production provider configuration: only AI_LOCAL_ENABLED is
// set, so base URL, model, timeout (120 s) and keep_alive (10m) are the
// provider defaults, and every provider safety check stays active.
// Two calls: a cold first call (may include the model load) and a warm one.

const ENABLED = process.env.OLLAMA_INTEGRATION === "1";

// Captured at import, before the per-test network guard replaces fetch.
const realFetch = globalThis.fetch;

// Longer than the provider timeout, so Vitest never cuts off a legitimate
// cold load before the provider's own timeout decides.
const TEST_TIMEOUT_MS = 240_000;

const FIXTURE_DIGEST: LocalDigest = buildLocalDigest(
  snapshotFor([
    {
      sku: "CHICKEN-BREAST",
      status: "LOW_STOCK",
      waste: 1100,
      wasteReason: "EXPIRED",
      openPo: 5000,
    },
    { sku: "MILK-1L", status: "OUT_OF_STOCK" },
    { sku: "EGG", adjustment: -12 },
    { sku: "RICE" },
  ]),
);

const PRODUCTION_ENV = { AI_LOCAL_ENABLED: "true" };

const reports: string[] = [];

async function runAndReport(
  label: "cold" | "warm",
): Promise<LocalAiResult> {
  vi.stubGlobal("fetch", realFetch);

  const started = performance.now();

  const result = await generateLocalAiSummary(
    FIXTURE_DIGEST,
    { env: PRODUCTION_ENV },
  );

  const latencyMs = Math.round(performance.now() - started);

  // Metadata, codes and drop reasons only: never the prompt, the digest or
  // the model's raw output.
  const report = JSON.stringify({
    run: label,
    ok: result.ok,
    error: result.ok
      ? null
      : `${result.error.code}/${result.error.reason}`,
    latency_ms: latencyMs,
    model: result.meta?.model ?? null,
    done_reason: result.meta?.done_reason ?? null,
    total_duration_ms:
      result.meta?.total_duration_ms ?? null,
    load_duration_ms: result.meta?.load_duration_ms ?? null,
    prompt_eval_count:
      result.meta?.prompt_eval_count ?? null,
    eval_count: result.meta?.eval_count ?? null,
    drop_reasons: result.ok
      ? result.output.dropped.map((entry) => entry.reason)
      : [],
  });

  reports.push(report);
  console.info(`[ollama-integration] ${report}`);

  return result;
}

function expectSuccessWithinLimits(result: LocalAiResult) {
  if (!result.ok) {
    throw new Error(
      `Local AI failed: ${result.error.code}/${result.error.reason}`,
    );
  }

  const { meta, output } = result;

  expect(meta.done_reason).toBe("stop");
  expect(meta.prompt_eval_count).not.toBeNull();
  expect(meta.eval_count).not.toBeNull();

  const promptTokens = meta.prompt_eval_count ?? Infinity;
  const outputTokens = meta.eval_count ?? Infinity;

  expect(promptTokens).toBeLessThan(
    OLLAMA_PROMPT_TOKEN_BUDGET,
  );
  expect(outputTokens).toBeLessThan(
    OLLAMA_MODEL_OPTIONS.num_predict,
  );
  expect(promptTokens + outputTokens).toBeLessThanOrEqual(
    OLLAMA_MODEL_OPTIONS.num_ctx,
  );

  const skus = new Set(
    FIXTURE_DIGEST.items.map((item) => item.sku),
  );

  for (const entry of output.attention) {
    expect(skus.has(entry.sku)).toBe(true);
  }

  expect(output.server_data_limits).toEqual([
    "USAGE_RATE_UNAVAILABLE",
    "FORECAST_UNAVAILABLE",
  ]);
}

describe.skipIf(!ENABLED)(
  "Ollama integration (real qwen3.5:4b on loopback)",
  () => {
    afterAll(() => {
      console.info(
        `[ollama-integration] summary\n${reports.join("\n")}`,
      );
    });

    it("runs with the calibrated production configuration", () => {
      expect(OLLAMA_DEFAULTS).toEqual({
        baseUrl: "http://127.0.0.1:11434",
        model: "qwen3.5:4b",
        timeoutMs: 120_000,
        keepAlive: "10m",
      });
      expect(OLLAMA_MODEL_OPTIONS).toEqual({
        temperature: 0,
        num_ctx: 2048,
        num_predict: 320,
      });
      expect(OLLAMA_PROMPT_TOKEN_BUDGET).toBe(1728);
    });

    it(
      "cold / first call returns validated, untruncated output within num_ctx",
      async () => {
        expectSuccessWithinLimits(await runAndReport("cold"));
      },
      TEST_TIMEOUT_MS,
    );

    it(
      "warm / second call returns validated, untruncated output within num_ctx",
      async () => {
        expectSuccessWithinLimits(await runAndReport("warm"));
      },
      TEST_TIMEOUT_MS,
    );
  },
);
