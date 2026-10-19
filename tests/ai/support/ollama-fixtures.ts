import { vi } from "vitest";

import {
  buildLocalDigest,
  type LocalDigest,
} from "@/lib/ai/local/digest";

import { snapshotFor } from "./local-fixtures";

// Fixed digest for provider tests (no Supabase, no real business data):
// MILK-1L        OUT_OF_STOCK, BELOW_MINIMUM
// CHICKEN-BREAST LOW_STOCK, WASTE (reorder covered by an open PO)
export function providerDigest(): LocalDigest {
  return buildLocalDigest(
    snapshotFor([
      {
        sku: "CHICKEN-BREAST",
        status: "LOW_STOCK",
        waste: 1100,
        openPo: 5000,
      },
      { sku: "MILK-1L", status: "OUT_OF_STOCK" },
      { sku: "RICE" },
    ]),
  );
}

export function emptyDigest(): LocalDigest {
  return buildLocalDigest(snapshotFor([{ sku: "RICE" }]));
}

export const ENABLED_ENV = {
  AI_LOCAL_ENABLED: "true",
} as const;

export function validModelOutput(
  overrides: Record<string, unknown> = {},
) {
  return {
    overview: "มีวัตถุดิบที่ต้องติดตาม",
    attention: [
      {
        sku: "MILK-1L",
        signal: "OUT_OF_STOCK",
        note: "ตรวจสอบการสั่งซื้อ",
      },
      {
        sku: "CHICKEN-BREAST",
        signal: "LOW_STOCK",
        note: "ตรวจสอบใบสั่งซื้อที่เปิดอยู่",
      },
    ],
    actions: ["ตรวจสอบใบสั่งซื้อที่เปิดอยู่"],
    ...overrides,
  };
}

export type OllamaEnvelope = {
  model?: string;
  message?: { role: string; content: string };
  done?: boolean;
  done_reason?: string;
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  eval_count?: number;
  [key: string]: unknown;
};

export function ollamaEnvelope(
  content: unknown,
  overrides: OllamaEnvelope = {},
): OllamaEnvelope {
  return {
    model: "qwen3.5:4b",
    created_at: "2026-10-15T03:00:00.000Z",
    message: {
      role: "assistant",
      content:
        typeof content === "string"
          ? content
          : JSON.stringify(content),
    },
    done: true,
    done_reason: "stop",
    total_duration: 2_345_678_901,
    load_duration: 512_345_678,
    prompt_eval_count: 900,
    prompt_eval_duration: 1_000_000_000,
    eval_count: 180,
    eval_duration: 800_000_000,
    ...overrides,
  };
}

export type FetchMock = ReturnType<typeof mockFetch>;

export function mockFetch(
  respond: (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => Promise<Response>,
) {
  const mock = vi.fn(respond);

  vi.stubGlobal("fetch", mock);

  return mock;
}

export function jsonResponse(
  body: unknown,
  status = 200,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function fetchReturning(envelope: OllamaEnvelope) {
  return mockFetch(async () => jsonResponse(envelope));
}

export function sentRequest(mock: FetchMock, call = 0) {
  const [input, init] = mock.mock.calls[call];

  return {
    url: String(input),
    init: init ?? {},
    body: JSON.parse(String(init?.body)) as Record<
      string,
      unknown
    >,
  };
}

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;

  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}
