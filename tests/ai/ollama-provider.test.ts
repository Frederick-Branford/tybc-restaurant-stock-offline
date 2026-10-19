import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { buildLocalAiMessages } from "@/lib/ai/local/prompt";
import { localAiOutputJsonSchema } from "@/lib/ai/local/schema";

import {
  buildOllamaFormatSchema,
  generatedTextPattern,
  generateLocalAiSummary,
  isLocalAiInFlight,
  OLLAMA_DEFAULTS,
  OLLAMA_MODEL_OPTIONS,
  OLLAMA_PROMPT_TOKEN_BUDGET,
  readLocalAiConfig,
} from "@/lib/ai/providers/ollama";

import type { LocalAiResult } from "@/lib/ai/providers/types";

import { NETWORK_BLOCKED_MESSAGE } from "../setup/test-guards";

import {
  deferred,
  emptyDigest,
  ENABLED_ENV,
  fetchReturning,
  jsonResponse,
  mockFetch,
  ollamaEnvelope,
  providerDigest,
  sentRequest,
  validModelOutput,
  type OllamaEnvelope,
} from "./support/ollama-fixtures";

function run(
  env: Record<string, string | undefined> = ENABLED_ENV,
  digest = providerDigest(),
): Promise<LocalAiResult> {
  return generateLocalAiSummary(digest, { env });
}

function errorOf(result: LocalAiResult) {
  expect(result.ok).toBe(false);

  return result.ok ? null : result.error;
}

function okResult(result: LocalAiResult) {
  if (!result.ok) {
    throw new Error(
      `expected success, got ${result.error.code}/${result.error.reason}`,
    );
  }

  return result;
}

async function runWith(envelope: OllamaEnvelope) {
  fetchReturning(envelope);

  return run();
}

describe("Ollama provider: configuration", () => {
  it.each([
    [{}],
    [{ AI_LOCAL_ENABLED: "false" }],
    [{ AI_LOCAL_ENABLED: "TRUE" }],
    [{ AI_LOCAL_ENABLED: "1" }],
  ])("1. is disabled unless AI_LOCAL_ENABLED is exactly true (%j)", async (env) => {
    const fetchMock = fetchReturning(
      ollamaEnvelope(validModelOutput()),
    );

    expect(errorOf(await run(env))).toEqual({
      code: "LOCAL_AI_DISABLED",
      reason: "NOT_ENABLED",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(["1", "", "production"])(
    "2. is disabled on Vercel (VERCEL=%j) even when enabled",
    async (vercel) => {
      const fetchMock = fetchReturning(
        ollamaEnvelope(validModelOutput()),
      );

      expect(
        errorOf(await run({ ...ENABLED_ENV, VERCEL: vercel })),
      ).toEqual({
        code: "LOCAL_AI_DISABLED",
        reason: "VERCEL_RUNTIME",
      });
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it("3. uses 127.0.0.1, qwen3.5:4b, 120000 ms and keep_alive 10m by default", () => {
    expect(readLocalAiConfig(ENABLED_ENV)).toEqual({
      ok: true,
      config: {
        baseUrl: "http://127.0.0.1:11434",
        chatUrl: "http://127.0.0.1:11434/api/chat",
        model: "qwen3.5:4b",
        timeoutMs: 120000,
        keepAlive: "10m",
      },
    });
    expect(OLLAMA_DEFAULTS).toEqual({
      baseUrl: "http://127.0.0.1:11434",
      model: "qwen3.5:4b",
      timeoutMs: 120000,
      keepAlive: "10m",
    });
  });

  it("uses the calibrated model options and prompt token budget", () => {
    expect(OLLAMA_MODEL_OPTIONS).toEqual({
      temperature: 0,
      num_ctx: 2048,
      num_predict: 320,
    });
    expect(OLLAMA_PROMPT_TOKEN_BUDGET).toBe(1728);
  });

  it("reads process.env by default and treats empty values as unset", async () => {
    vi.stubEnv("AI_LOCAL_ENABLED", "true");
    vi.stubEnv("OLLAMA_BASE_URL", "");
    vi.stubEnv("OLLAMA_MODEL", " ");
    vi.stubEnv("VERCEL", undefined);

    const fetchMock = fetchReturning(
      ollamaEnvelope(validModelOutput()),
    );

    okResult(await generateLocalAiSummary(providerDigest()));

    const { url, body } = sentRequest(fetchMock);

    expect(url).toBe("http://127.0.0.1:11434/api/chat");
    expect(body.model).toBe("qwen3.5:4b");
  });

  it.each([
    "http://127.0.0.1:11434",
    "http://127.0.0.1:11434/",
    "http://127.0.0.1:8080",
    "http://[::1]:11434",
  ])("accepts loopback base URL %s", (baseUrl) => {
    expect(
      readLocalAiConfig({
        ...ENABLED_ENV,
        OLLAMA_BASE_URL: baseUrl,
      }).ok,
    ).toBe(true);
  });

  it.each<[string, string]>([
    // 4. non-loopback or name-based hosts
    ["http://localhost:11434", "NON_LOOPBACK_HOST"],
    ["http://192.168.1.20:11434", "NON_LOOPBACK_HOST"],
    ["http://10.0.0.5:11434", "NON_LOOPBACK_HOST"],
    ["http://0.0.0.0:11434", "NON_LOOPBACK_HOST"],
    ["http://127.0.0.2:11434", "NON_LOOPBACK_HOST"],
    ["http://127.0.0.1.nip.io:11434", "NON_LOOPBACK_HOST"],
    // 5. public HTTP hosts
    ["http://ollama.example.com:11434", "NON_LOOPBACK_HOST"],
    ["http://8.8.8.8:11434", "NON_LOOPBACK_HOST"],
    // 6. HTTPS (remote or not) and other protocols
    ["https://ollama.example.com", "BASE_URL_PROTOCOL"],
    ["https://127.0.0.1:11434", "BASE_URL_PROTOCOL"],
    ["ftp://127.0.0.1:11434", "BASE_URL_PROTOCOL"],
    ["file:///etc/passwd", "BASE_URL_PROTOCOL"],
    // 7. credentials in the URL
    ["http://user:pass@127.0.0.1:11434", "BASE_URL_CREDENTIALS"],
    ["http://127.0.0.1:11434@evil.example", "BASE_URL_CREDENTIALS"],
    // paths, queries, fragments, garbage
    ["http://127.0.0.1:11434/v1", "BASE_URL_PATH"],
    ["http://127.0.0.1:11434/?x=1", "BASE_URL_PATH"],
    ["http://127.0.0.1:11434/#x", "BASE_URL_PATH"],
    ["not a url", "INVALID_BASE_URL"],
  ])(
    "4-7. rejects base URL %s (%s) without calling fetch",
    async (baseUrl, reason) => {
      const fetchMock = fetchReturning(
        ollamaEnvelope(validModelOutput()),
      );

      expect(
        errorOf(
          await run({
            ...ENABLED_ENV,
            OLLAMA_BASE_URL: baseUrl,
          }),
        ),
      ).toEqual({
        code: "LOCAL_AI_CONFIGURATION_ERROR",
        reason,
      });
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it.each<[Record<string, string>, string]>([
    [{ OLLAMA_MODEL: "qwen 3.5" }, "INVALID_MODEL"],
    [{ OLLAMA_MODEL: "-bad" }, "INVALID_MODEL"],
    [{ OLLAMA_TIMEOUT_MS: "abc" }, "INVALID_TIMEOUT"],
    [{ OLLAMA_TIMEOUT_MS: "999" }, "INVALID_TIMEOUT"],
    [{ OLLAMA_TIMEOUT_MS: "300001" }, "INVALID_TIMEOUT"],
    [{ OLLAMA_TIMEOUT_MS: "60000.5" }, "INVALID_TIMEOUT"],
    [{ OLLAMA_KEEP_ALIVE: "-1" }, "INVALID_KEEP_ALIVE"],
    [{ OLLAMA_KEEP_ALIVE: "0" }, "INVALID_KEEP_ALIVE"],
    [{ OLLAMA_KEEP_ALIVE: "forever" }, "INVALID_KEEP_ALIVE"],
    [{ OLLAMA_KEEP_ALIVE: "25h" }, "INVALID_KEEP_ALIVE"],
  ])("rejects invalid setting %j (%s)", (overrides, reason) => {
    expect(
      readLocalAiConfig({ ...ENABLED_ENV, ...overrides }),
    ).toEqual({
      ok: false,
      error: {
        code: "LOCAL_AI_CONFIGURATION_ERROR",
        reason,
      },
    });
  });

  it("accepts conservative custom model, timeout and keep_alive values", () => {
    expect(
      readLocalAiConfig({
        ...ENABLED_ENV,
        OLLAMA_MODEL: "qwen3.5:4b-instruct-q4_K_M",
        OLLAMA_TIMEOUT_MS: "90000",
        OLLAMA_KEEP_ALIVE: "1h",
      }),
    ).toMatchObject({
      ok: true,
      config: {
        model: "qwen3.5:4b-instruct-q4_K_M",
        timeoutMs: 90000,
        keepAlive: "1h",
      },
    });
  });

  it("never reads NEXT_PUBLIC_* configuration", () => {
    expect(
      readLocalAiConfig({
        ...ENABLED_ENV,
        NEXT_PUBLIC_AI_LOCAL_ENABLED: "false",
        NEXT_PUBLIC_OLLAMA_BASE_URL: "http://ollama.example.com",
        NEXT_PUBLIC_OLLAMA_MODEL: "other-model",
      }),
    ).toMatchObject({
      ok: true,
      config: {
        baseUrl: "http://127.0.0.1:11434",
        model: "qwen3.5:4b",
      },
    });

    expect(
      readLocalAiConfig({
        NEXT_PUBLIC_AI_LOCAL_ENABLED: "true",
      }).ok,
    ).toBe(false);
  });
});

describe("Ollama provider: request", () => {
  it("8-18. sends one POST /api/chat to loopback with the exact body", async () => {
    const digest = providerDigest();
    const fetchMock = fetchReturning(
      ollamaEnvelope(validModelOutput()),
    );

    okResult(await run(ENABLED_ENV, digest));

    expect(fetchMock).toHaveBeenCalledTimes(1);

    const { url, init, body } = sentRequest(fetchMock);

    expect(init.method).toBe("POST");
    expect(url).toBe("http://127.0.0.1:11434/api/chat");
    expect(init.redirect).toBe("error");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.headers).toMatchObject({
      "Content-Type": "application/json",
    });

    expect(Object.keys(body).sort()).toEqual([
      "format",
      "keep_alive",
      "messages",
      "model",
      "options",
      "stream",
      "think",
    ]);
    expect(body).not.toHaveProperty("tools");
    expect(body.model).toBe("qwen3.5:4b");
    expect(body.stream).toBe(false);
    expect(body.think).toBe(false);
    expect(body.keep_alive).toBe("10m");
    expect(body.options).toEqual({
      temperature: 0,
      num_ctx: 2048,
      num_predict: 320,
    });
    expect(OLLAMA_MODEL_OPTIONS).toEqual(body.options);
    expect(body.messages).toEqual(
      buildLocalAiMessages(digest),
    );
    expect(body.format).toEqual(
      buildOllamaFormatSchema(digest),
    );
  });

  it("passes custom model and keep_alive through", async () => {
    const fetchMock = fetchReturning(
      ollamaEnvelope(validModelOutput()),
    );

    await run({
      ...ENABLED_ENV,
      OLLAMA_MODEL: "qwen3.5:4b-q8_0",
      OLLAMA_KEEP_ALIVE: "30m",
      OLLAMA_BASE_URL: "http://[::1]:11500",
    });

    const { url, body } = sentRequest(fetchMock);

    expect(url).toBe("http://[::1]:11500/api/chat");
    expect(body.model).toBe("qwen3.5:4b-q8_0");
    expect(body.keep_alive).toBe("30m");
  });

  it("19. restricts attention[].sku to the digest SKUs", () => {
    const format = buildOllamaFormatSchema(providerDigest());

    expect(format).toMatchObject({
      properties: {
        attention: {
          maxItems: 2,
          items: {
            properties: {
              sku: {
                type: "string",
                enum: ["MILK-1L", "CHICKEN-BREAST"],
              },
              signal: {
                enum: [
                  "OUT_OF_STOCK",
                  "LOW_STOCK",
                  "BELOW_MINIMUM",
                  "WASTE",
                  "ADJUSTMENT",
                ],
              },
            },
            additionalProperties: false,
          },
        },
      },
      additionalProperties: false,
    });
  });

  it("19/20. never mutates the shared base JSON Schema (no SKU enum, no patterns)", () => {
    const before = JSON.stringify(localAiOutputJsonSchema);

    const first = buildOllamaFormatSchema(providerDigest());
    const second = buildOllamaFormatSchema(emptyDigest());

    expect(JSON.stringify(localAiOutputJsonSchema)).toBe(
      before,
    );
    expect(first).not.toBe(localAiOutputJsonSchema);
    expect(JSON.stringify(first)).not.toBe(
      JSON.stringify(second),
    );
    expect(before).not.toContain("MILK-1L");
    expect(before).not.toContain('"pattern"');
  });

  describe("request-specific no-digit patterns", () => {
    type Node = {
      pattern?: string;
      maxLength?: number;
      enum?: string[];
      items?: Node & { properties?: Record<string, Node> };
      properties?: Record<string, Node>;
    };

    const format = buildOllamaFormatSchema(
      providerDigest(),
    ) as Node;

    const properties = format.properties ?? {};
    const overview = properties.overview;
    const note = properties.attention.items?.properties?.note;
    const action = properties.actions.items;
    const sku = properties.attention.items?.properties?.sku;

    const generated: [string, Node | undefined, number][] = [
      ["overview", overview, 120],
      ["attention[].note", note, 80],
      ["actions[]", action, 80],
    ];

    function compile(node: Node | undefined): RegExp {
      expect(node?.pattern).toBeTypeOf("string");

      // JSON Schema patterns are ECMA-262 regular expressions.
      return new RegExp(node?.pattern ?? "", "u");
    }

    it.each(generated)(
      "%s carries the no-digit pattern with its max length",
      (_field, node, max) => {
        expect(node?.pattern).toBe(generatedTextPattern(max));
        expect(node?.maxLength).toBe(max);
      },
    );

    it.each(generated)(
      "16. %s pattern rejects ASCII digits",
      (_field, node) => {
        const pattern = compile(node);

        for (const text of [
          "มี 3 รายการ",
          "สั่ง 10 ถุง",
          "0",
          "หมดใน 2 วัน",
        ]) {
          expect(pattern.test(text)).toBe(false);
        }
      },
    );

    it.each(generated)(
      "17. %s pattern rejects Thai digits",
      (_field, node) => {
        const pattern = compile(node);

        for (const text of ["มี ๓ รายการ", "๑๐", "หมดใน ๒ วัน"]) {
          expect(pattern.test(text)).toBe(false);
        }
      },
    );

    it.each(generated)(
      "%s pattern accepts short Thai text and enforces 1..max length",
      (_field, node, max) => {
        const pattern = compile(node);

        expect(pattern.test("ตรวจสอบสาเหตุของของเสีย")).toBe(true);
        expect(pattern.test("ตรวจสอบการเติมสต็อก")).toBe(true);
        expect(pattern.test("")).toBe(false);
        expect(pattern.test("ก".repeat(max))).toBe(true);
        expect(pattern.test("ก".repeat(max + 1))).toBe(false);
      },
    );

    it.each(generated)(
      "%s pattern rejects quotes, backslashes and control characters (keeps grammar output valid JSON)",
      (_field, node) => {
        const pattern = compile(node);

        for (const text of ['a"b', "a\\b", "a\nb", "a\tb"]) {
          expect(pattern.test(text)).toBe(false);
        }
      },
    );

    it("18. sku has no pattern, so SKUs with digits remain allowed", () => {
      expect(sku?.pattern).toBeUndefined();
      expect(sku?.enum).toContain("MILK-1L");
    });

    it("applies the patterns for a zero-item digest too", () => {
      const empty = buildOllamaFormatSchema(
        emptyDigest(),
      ) as Node;

      expect(empty.properties?.overview.pattern).toBe(
        generatedTextPattern(120),
      );
      expect(
        empty.properties?.actions.items?.pattern,
      ).toBe(generatedTextPattern(80));
    });
  });

  it("35. handles a zero-item digest: no empty enum, attention limited to zero", async () => {
    const digest = emptyDigest();

    expect(digest.items).toEqual([]);

    const format = buildOllamaFormatSchema(digest);

    expect(format).toMatchObject({
      properties: {
        attention: {
          maxItems: 0,
          items: {
            properties: {
              sku: {
                type: "string",
                minLength: 1,
                maxLength: 48,
              },
            },
          },
        },
      },
    });
    expect(JSON.stringify(format)).not.toContain('"enum":[]');

    fetchReturning(
      ollamaEnvelope(
        validModelOutput({
          overview: "สต็อกทุกรายการปกติ",
          attention: [],
        }),
      ),
    );

    const result = okResult(await run(ENABLED_ENV, digest));

    expect(result.output.attention).toEqual([]);
    expect(result.output.overview).toBe(
      "สต็อกทุกรายการปกติ",
    );
  });

  it("throws for an invalid digest before sending anything or taking the lock", async () => {
    const fetchMock = fetchReturning(
      ollamaEnvelope(validModelOutput()),
    );

    await expect(
      generateLocalAiSummary(
        { items: "not a digest" } as never,
        { env: ENABLED_ENV },
      ),
    ).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(isLocalAiInFlight()).toBe(false);
  });
});

describe("Ollama provider: response pipeline", () => {
  it("21. returns output that passed Zod and semantic validation", async () => {
    const result = okResult(
      await runWith(ollamaEnvelope(validModelOutput())),
    );

    expect(result.output).toEqual({
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
      server_data_limits: [
        "USAGE_RATE_UNAVAILABLE",
        "FORECAST_UNAVAILABLE",
      ],
      dropped: [],
    });
  });

  it("22. unknown SKUs and mismatched signals cannot survive", async () => {
    const result = okResult(
      await runWith(
        ollamaEnvelope(
          validModelOutput({
            attention: [
              {
                sku: "LOBSTER",
                signal: "LOW_STOCK",
                note: "ไม่มีในข้อมูล",
              },
              {
                sku: "CHICKEN-BREAST",
                signal: "OUT_OF_STOCK",
                note: "สถานะผิด",
              },
            ],
          }),
        ),
      ),
    );

    expect(result.output.attention).toEqual([]);
    expect(
      result.output.dropped.map((entry) => entry.reason),
    ).toEqual(["UNKNOWN_SKU", "SIGNAL_NOT_IN_DIGEST"]);
  });

  it("numeric claims in note, overview and actions are dropped even if the grammar let them through", async () => {
    const result = okResult(
      await runWith(
        ollamaEnvelope(
          validModelOutput({
            overview: "มี 2 รายการที่ต้องดู",
            attention: [
              {
                sku: "CHICKEN-BREAST",
                signal: "WASTE",
                note: "ของเสีย 1100 กรัม",
              },
              {
                sku: "CHICKEN-BREAST",
                signal: "WASTE",
                note: "ตรวจสอบสาเหตุของของเสีย",
              },
            ],
            actions: ["สั่งเพิ่ม ๕ ลัง", "ตรวจสอบตู้แช่"],
          }),
        ),
      ),
    );

    expect(result.output).toMatchObject({
      overview: null,
      attention: [
        {
          sku: "CHICKEN-BREAST",
          signal: "WASTE",
          note: "ตรวจสอบสาเหตุของของเสีย",
        },
      ],
      actions: ["ตรวจสอบตู้แช่"],
    });
    expect(
      result.output.dropped.map((entry) => entry.reason),
    ).toEqual(["NUMERIC_CLAIM", "NUMERIC_CLAIM", "NUMERIC_CLAIM"]);
  });

  it.each<[string, OllamaEnvelope, string]>([
    [
      "23. invalid JSON content",
      ollamaEnvelope('{"overview": "ไม่ครบ'),
      "INVALID_JSON",
    ],
    [
      "24. JSON that fails the Zod schema (unknown signal)",
      ollamaEnvelope(
        validModelOutput({
          attention: [
            {
              sku: "MILK-1L",
              signal: "EXPIRING",
              note: "x",
            },
          ],
        }),
      ),
      "SCHEMA_INVALID",
    ],
    [
      "24. JSON with a numeric field",
      ollamaEnvelope(
        validModelOutput({ current_quantity: 6500 }),
      ),
      "SCHEMA_INVALID",
    ],
    [
      "24. a JSON array instead of an object",
      ollamaEnvelope("[]"),
      "SCHEMA_INVALID",
    ],
    [
      "7. model-written data_limits (extra key)",
      ollamaEnvelope(
        validModelOutput({
          data_limits: ["ยังไม่มีข้อมูลอัตราการใช้"],
        }),
      ),
      "SCHEMA_INVALID",
    ],
    [
      "3 attention entries (above the compact limit)",
      ollamaEnvelope(
        validModelOutput({
          attention: [
            { sku: "MILK-1L", signal: "OUT_OF_STOCK", note: "ก" },
            { sku: "MILK-1L", signal: "BELOW_MINIMUM", note: "ข" },
            { sku: "CHICKEN-BREAST", signal: "WASTE", note: "ค" },
          ],
        }),
      ),
      "SCHEMA_INVALID",
    ],
    [
      "25. done_reason=length (truncated) even with valid JSON",
      ollamaEnvelope(validModelOutput(), {
        done_reason: "length",
      }),
      "TRUNCATED",
    ],
    [
      "26. empty model content",
      ollamaEnvelope(""),
      "EMPTY_CONTENT",
    ],
    [
      "26. whitespace-only model content",
      ollamaEnvelope("  \n "),
      "EMPTY_CONTENT",
    ],
    [
      "done=false",
      ollamaEnvelope(validModelOutput(), { done: false }),
      "NOT_DONE",
    ],
    [
      "done_reason=load",
      ollamaEnvelope(validModelOutput(), {
        done_reason: "load",
      }),
      "UNEXPECTED_DONE_REASON",
    ],
    [
      "missing done_reason",
      ollamaEnvelope(validModelOutput(), {
        done_reason: undefined,
      }),
      "UNEXPECTED_DONE_REASON",
    ],
  ])("%s -> INVALID_MODEL_OUTPUT", async (_label, envelope, reason) => {
    const result = await runWith(envelope);

    expect(errorOf(result)).toEqual({
      code: "INVALID_MODEL_OUTPUT",
      reason,
    });
    expect(result.meta).not.toBeNull();
  });

  it.each<[string, Response | (() => Response), Record<string, unknown>]>([
    [
      "HTTP 404 (model not pulled)",
      () =>
        jsonResponse({ error: "model not found" }, 404),
      {
        code: "OLLAMA_REQUEST_FAILED",
        reason: "HTTP_ERROR",
        http_status: 404,
      },
    ],
    [
      "HTTP 500",
      () => jsonResponse({ error: "boom" }, 500),
      {
        code: "OLLAMA_REQUEST_FAILED",
        reason: "HTTP_ERROR",
        http_status: 500,
      },
    ],
    [
      "non-JSON body",
      () => new Response("<html>proxy</html>"),
      {
        code: "OLLAMA_REQUEST_FAILED",
        reason: "INVALID_RESPONSE",
      },
    ],
    [
      "envelope without message",
      () => jsonResponse({ model: "x", done: true }),
      {
        code: "OLLAMA_REQUEST_FAILED",
        reason: "INVALID_RESPONSE",
      },
    ],
  ])("maps %s to a request failure", async (_label, response, error) => {
    mockFetch(async () =>
      typeof response === "function" ? response() : response,
    );

    const result = await run();

    expect(errorOf(result)).toEqual(error);
    expect(result.meta).toBeNull();
  });

  it("maps a failure while reading the body to OLLAMA_REQUEST_FAILED", async () => {
    mockFetch(async () => {
      const response = jsonResponse({});

      vi.spyOn(response, "text").mockRejectedValue(
        new Error("socket hang up"),
      );

      return response;
    });

    expect(errorOf(await run())).toEqual({
      code: "OLLAMA_REQUEST_FAILED",
      reason: "INVALID_RESPONSE",
    });
  });

  it("36. returns token and timing metadata from the Ollama response", async () => {
    const result = okResult(
      await runWith(
        ollamaEnvelope(validModelOutput(), {
          model: "qwen3.5:4b-runtime-reported",
          total_duration: 2_345_678_901,
          load_duration: 512_345_678,
          prompt_eval_count: 901,
          eval_count: 177,
        }),
      ),
    );

    expect(result.meta).toEqual({
      provider: "ollama",
      model: "qwen3.5:4b-runtime-reported",
      done_reason: "stop",
      total_duration_ms: 2346,
      load_duration_ms: 512,
      prompt_eval_count: 901,
      eval_count: 177,
    });
  });
});

describe("Ollama provider: completion and context checks", () => {
  it.each<[string, OllamaEnvelope, string | null]>([
    [
      "output reached num_predict (eval_count 320)",
      { eval_count: 320 },
      "OUTPUT_LIMIT_REACHED",
    ],
    [
      "output above num_predict (eval_count 321)",
      { eval_count: 321 },
      "OUTPUT_LIMIT_REACHED",
    ],
    [
      "prompt used the whole prompt budget (1728 = 2048 - 320)",
      { prompt_eval_count: 1728 },
      "CONTEXT_BUDGET_EXCEEDED",
    ],
    [
      "replay of the first real run (668 + 256, done_reason length) stays TRUNCATED",
      {
        prompt_eval_count: 668,
        eval_count: 256,
        done_reason: "length",
      },
      "TRUNCATED",
    ],
    [
      "the same token counts with done_reason stop fit the new limits",
      { prompt_eval_count: 668, eval_count: 256 },
      null,
    ],
    [
      "prompt larger than num_ctx",
      { prompt_eval_count: 2100, eval_count: 10 },
      "CONTEXT_BUDGET_EXCEEDED",
    ],
    [
      "missing prompt_eval_count",
      { prompt_eval_count: undefined },
      "CONTEXT_UNVERIFIABLE",
    ],
    [
      "missing eval_count",
      { eval_count: undefined },
      "CONTEXT_UNVERIFIABLE",
    ],
    [
      "largest accepted counts (1727 + 319 = 2046)",
      { prompt_eval_count: 1727, eval_count: 319 },
      null,
    ],
  ])("37. %s", async (_label, overrides, reason) => {
    const result = await runWith(
      ollamaEnvelope(validModelOutput(), overrides),
    );

    if (reason === null) {
      expect(result.ok).toBe(true);
    } else {
      expect(errorOf(result)).toEqual({
        code: "INVALID_MODEL_OUTPUT",
        reason,
      });
    }
  });
});

describe("Ollama provider: network failures and timeout", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("27. maps a connection failure to OLLAMA_UNREACHABLE", async () => {
    mockFetch(async () => {
      throw new TypeError("fetch failed", {
        cause: { code: "ECONNREFUSED" },
      });
    });

    const result = await run();

    expect(errorOf(result)).toEqual({
      code: "OLLAMA_UNREACHABLE",
      reason: "CONNECTION_FAILED",
    });
    expect(JSON.stringify(result)).not.toMatch(
      /ECONNREFUSED|fetch failed|stack/,
    );
  });

  it("28. aborts the request at the configured timeout -> OLLAMA_TIMEOUT", async () => {
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout"],
    });

    const fetchMock = mockFetch(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(
              new DOMException(
                "This operation was aborted",
                "AbortError",
              ),
            ),
          );
        }),
    );

    const pending = run({
      ...ENABLED_ENV,
      OLLAMA_TIMEOUT_MS: "5000",
    });

    await vi.advanceTimersByTimeAsync(4999);

    expect(
      sentRequest(fetchMock).init.signal?.aborted,
    ).toBe(false);

    await vi.advanceTimersByTimeAsync(1);

    expect(errorOf(await pending)).toEqual({
      code: "OLLAMA_TIMEOUT",
      reason: "TIMEOUT",
    });
    expect(isLocalAiInFlight()).toBe(false);
  });

  it("uses the 120000 ms default timeout when OLLAMA_TIMEOUT_MS is not set", async () => {
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout"],
    });

    const fetchMock = mockFetch(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(
              new DOMException(
                "This operation was aborted",
                "AbortError",
              ),
            ),
          );
        }),
    );

    const pending = run(ENABLED_ENV);

    await vi.advanceTimersByTimeAsync(119_999);

    expect(
      sentRequest(fetchMock).init.signal?.aborted,
    ).toBe(false);

    await vi.advanceTimersByTimeAsync(1);

    expect(errorOf(await pending)).toEqual({
      code: "OLLAMA_TIMEOUT",
      reason: "TIMEOUT",
    });
    expect(isLocalAiInFlight()).toBe(false);
  });

  it("clears the timeout after a response", async () => {
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout"],
    });

    fetchReturning(ollamaEnvelope(validModelOutput()));

    okResult(await run());

    expect(vi.getTimerCount()).toBe(0);
  });

  it("33. unit tests never reach the network: an unmocked fetch is blocked", async () => {
    // The test harness replaces global fetch with a guard that throws.
    await expect(
      fetch("http://127.0.0.1:11434/api/chat"),
    ).rejects.toThrow(NETWORK_BLOCKED_MESSAGE);

    expect(errorOf(await run())).toEqual({
      code: "OLLAMA_UNREACHABLE",
      reason: "CONNECTION_FAILED",
    });
  });
});

describe("Ollama provider: single flight", () => {
  it("29. a second concurrent request fails immediately with LOCAL_AI_BUSY", async () => {
    const gate = deferred<Response>();
    const fetchMock = mockFetch(() => gate.promise);

    const first = run();

    expect(isLocalAiInFlight()).toBe(true);

    const second = await run();

    expect(errorOf(second)).toEqual({
      code: "LOCAL_AI_BUSY",
      reason: "REQUEST_IN_FLIGHT",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    gate.resolve(
      jsonResponse(ollamaEnvelope(validModelOutput())),
    );

    okResult(await first);
  });

  it("30. releases the lock after success", async () => {
    fetchReturning(ollamaEnvelope(validModelOutput()));

    okResult(await run());

    expect(isLocalAiInFlight()).toBe(false);
    okResult(await run());
  });

  it("31. releases the lock after a fetch failure", async () => {
    mockFetch(async () => {
      throw new TypeError("fetch failed");
    });

    expect(errorOf(await run())?.code).toBe(
      "OLLAMA_UNREACHABLE",
    );
    expect(isLocalAiInFlight()).toBe(false);

    fetchReturning(ollamaEnvelope(validModelOutput()));

    okResult(await run());
  });

  it.each<[string, OllamaEnvelope]>([
    [
      "32. validation failure",
      ollamaEnvelope(
        validModelOutput({ reorder_required: true }),
      ),
    ],
    ["JSON parse failure", ollamaEnvelope("{not json")],
    [
      "truncated output",
      ollamaEnvelope(validModelOutput(), {
        done_reason: "length",
      }),
    ],
  ])("releases the lock after %s", async (_label, envelope) => {
    fetchReturning(envelope);

    expect(errorOf(await run())?.code).toBe(
      "INVALID_MODEL_OUTPUT",
    );
    expect(isLocalAiInFlight()).toBe(false);

    fetchReturning(ollamaEnvelope(validModelOutput()));

    okResult(await run());
  });

  it("releases the lock after a timeout", async () => {
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout"],
    });

    mockFetch(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    );

    const pending = run({
      ...ENABLED_ENV,
      OLLAMA_TIMEOUT_MS: "1000",
    });

    await vi.advanceTimersByTimeAsync(1000);

    expect(errorOf(await pending)?.code).toBe(
      "OLLAMA_TIMEOUT",
    );

    vi.useRealTimers();

    expect(isLocalAiInFlight()).toBe(false);

    fetchReturning(ollamaEnvelope(validModelOutput()));

    okResult(await run());
  });

  it("does not take the lock when disabled or misconfigured", async () => {
    const gate = deferred<Response>();

    mockFetch(() => gate.promise);

    const first = run();

    expect(
      errorOf(await run({ AI_LOCAL_ENABLED: "false" }))?.code,
    ).toBe("LOCAL_AI_DISABLED");

    gate.resolve(
      jsonResponse(ollamaEnvelope(validModelOutput())),
    );

    okResult(await first);
  });
});

describe("Ollama provider: no leakage", () => {
  const consoleMethods = [
    "log",
    "info",
    "warn",
    "error",
    "debug",
  ] as const;

  beforeEach(() => {
    for (const method of consoleMethods) {
      vi.spyOn(console, method);
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("34. never logs, and errors carry no prompt, digest or model text", async () => {
    const failures: LocalAiResult[] = [];

    fetchReturning(ollamaEnvelope(validModelOutput()));
    okResult(await run());

    fetchReturning(ollamaEnvelope("{broken"));
    failures.push(await run());

    fetchReturning(
      ollamaEnvelope(validModelOutput({ extra: "MILK-1L" })),
    );
    failures.push(await run());

    mockFetch(async () => {
      throw new TypeError("fetch failed");
    });
    failures.push(await run());

    for (const method of consoleMethods) {
      expect(console[method]).not.toHaveBeenCalled();
    }

    for (const failure of failures) {
      const text = JSON.stringify(failure);

      expect(text).not.toMatch(
        /MILK-1L|CHICKEN-BREAST|DATA|You explain|นม|broken/,
      );
    }
  });
});
