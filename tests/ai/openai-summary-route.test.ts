import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { POST } from "@/app/api/ai/summary/route";

// Characterization tests for the existing OpenAI AI Summary endpoint.
// They lock in current behavior before Local AI work starts.
// Supabase, the business snapshot and the OpenAI SDK are mocked;
// src/lib/ai/openai.ts runs for real against the mocked SDK.

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  rpc: vi.fn(),
  adminFrom: vi.fn(),
  buildBusinessSnapshot: vi.fn(),
  openAIConstructor: vi.fn(),
  responsesCreate: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: mocks.getUser,
    },
  }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: mocks.rpc,
    from: mocks.adminFrom,
  }),
}));

vi.mock("@/lib/ai/business-snapshot", () => ({
  buildBusinessSnapshot: mocks.buildBusinessSnapshot,
}));

vi.mock("openai", () => ({
  default: class MockOpenAI {
    responses = {
      create: mocks.responsesCreate,
    };

    constructor(options: unknown) {
      mocks.openAIConstructor(options);
    }
  },
}));

const TEST_API_KEY = "test-openai-key-not-real";
const TEST_MODEL = "test-model";
const NOW = "2026-10-15T03:00:00.000Z";

const USER = {
  id: "00000000-0000-4000-8000-000000000001",
  email: "owner@example.test",
};

const SNAPSHOT = {
  generated_at: "2026-10-15T02:59:59.000Z",
  analysis_period: {
    movement_days: 7,
    movement_since: "2026-10-08T02:59:59.000Z",
  },
  inventory: {
    total_items: 1,
    low_stock_count: 1,
    items: [
      {
        sku: "TEST-001",
        name: "Test item",
        current_quantity: 2,
        unit: "kg",
        minimum_stock: 1,
        reorder_point: 5,
        difference_from_reorder: -3,
        status: "LOW_STOCK",
      },
    ],
  },
  movement_7d: [],
  waste_7d: {
    total_events: 0,
    reason_event_counts: {},
  },
  purchasing: {
    total_purchase_orders: 0,
    status_counts: {},
  },
  limitations: ["test limitation"],
};

const ERRORS = {
  unauthenticated: "กรุณาเข้าสู่ระบบ",
  forbidden: "บัญชีนี้ไม่มีสิทธิ์ใช้งาน AI",
  permissionCheckFailed: "ไม่สามารถตรวจสอบสิทธิ์ AI ได้",
  generationFailed:
    "ไม่สามารถวิเคราะห์ข้อมูลด้วย AI ได้ในขณะนี้",
};

function signedIn() {
  mocks.getUser.mockResolvedValue({
    data: { user: USER },
    error: null,
  });
}

function permission(allowed: boolean | null) {
  mocks.rpc.mockResolvedValue({
    data: allowed,
    error: null,
  });
}

function happyPath(outputText = "  ภาพรวม:\nสรุปสถานการณ์ร้าน  \n") {
  signedIn();
  permission(true);
  mocks.buildBusinessSnapshot.mockResolvedValue(SNAPSHOT);
  mocks.responsesCreate.mockResolvedValue({
    output_text: outputText,
  });
}

async function callRoute() {
  const response = await POST();

  return {
    status: response.status,
    body: (await response.json()) as Record<string, unknown>,
  };
}

function openAIRequest() {
  expect(mocks.responsesCreate).toHaveBeenCalledTimes(1);

  return mocks.responsesCreate.mock.calls[0][0] as Record<
    string,
    unknown
  >;
}

function expectNoAiWork() {
  expect(mocks.buildBusinessSnapshot).not.toHaveBeenCalled();
  expect(mocks.openAIConstructor).not.toHaveBeenCalled();
  expect(mocks.responsesCreate).not.toHaveBeenCalled();
}

describe("POST /api/ai/summary (OpenAI, characterization)", () => {
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    for (const mock of Object.values(mocks)) {
      mock.mockReset();
    }

    vi.stubEnv("OPENAI_API_KEY", TEST_API_KEY);
    vi.stubEnv("OPENAI_MODEL", TEST_MODEL);

    consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe("authentication", () => {
    it("returns 401 when there is no signed-in user", async () => {
      mocks.getUser.mockResolvedValue({
        data: { user: null },
        error: null,
      });

      const { status, body } = await callRoute();

      expect(status).toBe(401);
      expect(body).toEqual({ error: ERRORS.unauthenticated });
      expect(mocks.rpc).not.toHaveBeenCalled();
      expectNoAiWork();
    });

    it("returns 401 when Supabase auth returns an error", async () => {
      mocks.getUser.mockResolvedValue({
        data: { user: null },
        error: { message: "invalid JWT" },
      });

      const { status, body } = await callRoute();

      expect(status).toBe(401);
      expect(body).toEqual({ error: ERRORS.unauthenticated });
      expect(mocks.rpc).not.toHaveBeenCalled();
      expectNoAiWork();
    });
  });

  describe("authorization", () => {
    it.each([false, null])(
      "returns 403 when ai.use is not granted (rpc data: %s)",
      async (allowed) => {
        signedIn();
        permission(allowed);

        const { status, body } = await callRoute();

        expect(status).toBe(403);
        expect(body).toEqual({ error: ERRORS.forbidden });
        expectNoAiWork();
      },
    );

    it("checks the ai.use permission for the signed-in user", async () => {
      signedIn();
      permission(false);

      await callRoute();

      expect(mocks.rpc).toHaveBeenCalledTimes(1);
      expect(mocks.rpc).toHaveBeenCalledWith(
        "user_has_permission",
        {
          p_user_id: USER.id,
          requested_permission: "ai.use",
        },
      );
    });

    it("returns 500 when the permission check fails", async () => {
      signedIn();
      mocks.rpc.mockResolvedValue({
        data: null,
        error: { message: "permission rpc failed" },
      });

      const { status, body } = await callRoute();

      expect(status).toBe(500);
      expect(body).toEqual({
        error: ERRORS.permissionCheckFailed,
      });
      expect(consoleError).toHaveBeenCalled();
      expectNoAiWork();
    });
  });

  describe("successful request", () => {
    it("calls the OpenAI Responses API once with store:false and max_output_tokens:800", async () => {
      happyPath();

      const { status } = await callRoute();

      expect(status).toBe(200);
      expect(mocks.buildBusinessSnapshot).toHaveBeenCalledTimes(1);
      expect(mocks.openAIConstructor).toHaveBeenCalledWith({
        apiKey: TEST_API_KEY,
      });

      const request = openAIRequest();

      expect(request.model).toBe(TEST_MODEL);
      expect(request.store).toBe(false);
      expect(request.max_output_tokens).toBe(800);
      expect(request.input).toBe(JSON.stringify(SNAPSHOT));
    });

    it("sends only model, store, max_output_tokens, instructions and input (no tools)", async () => {
      happyPath();

      await callRoute();

      expect(Object.keys(openAIRequest()).sort()).toEqual([
        "input",
        "instructions",
        "max_output_tokens",
        "model",
        "store",
      ]);
    });

    it("sends the existing read-only analyst instructions", async () => {
      happyPath();

      await callRoute();

      const { instructions } = openAIRequest();

      expect(typeof instructions).toBe("string");

      const text = instructions as string;

      expect(text).toBe(text.trim());
      expect(text).toContain("ห้ามแต่งตัวเลขขึ้นเอง");
      expect(text).toContain(
        "current_quantity, reorder_point และ stock_status จากฐานข้อมูลเป็น Source of Truth",
      );
      expect(text).toContain(
        "AI มีหน้าที่วิเคราะห์เท่านั้น ไม่มีอำนาจแก้ไขข้อมูล",
      );
      expect(text).toContain("ใช้ Plain Text เท่านั้น");
    });

    it("returns the existing { summary, model, generated_at } shape", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date(NOW));
      happyPath();

      const { status, body } = await callRoute();

      expect(status).toBe(200);
      expect(Object.keys(body).sort()).toEqual([
        "generated_at",
        "model",
        "summary",
      ]);
      expect(body).toEqual({
        summary: "ภาพรวม:\nสรุปสถานการณ์ร้าน",
        model: TEST_MODEL,
        generated_at: NOW,
      });
    });

    it("uses the default model when OPENAI_MODEL is not set", async () => {
      vi.stubEnv("OPENAI_MODEL", undefined);
      happyPath();

      const { status, body } = await callRoute();

      expect(status).toBe(200);
      expect(openAIRequest().model).toBe("gpt-6.1-sol");
      expect(body.model).toBe("gpt-6.1-sol");
    });

    it("does not read tables directly or touch the network", async () => {
      happyPath();

      await callRoute();

      expect(mocks.adminFrom).not.toHaveBeenCalled();
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });
  });

  describe("failure handling", () => {
    it("returns 500 when OpenAI returns an empty response", async () => {
      happyPath("   \n  ");

      const { status, body } = await callRoute();

      expect(status).toBe(500);
      expect(body).toEqual({ error: ERRORS.generationFailed });
      expect(consoleError).toHaveBeenCalled();
    });

    it("returns 500 when the OpenAI request fails", async () => {
      happyPath();
      mocks.responsesCreate.mockRejectedValue(
        new Error("upstream unavailable"),
      );

      const { status, body } = await callRoute();

      expect(status).toBe(500);
      expect(body).toEqual({ error: ERRORS.generationFailed });
      expect(consoleError).toHaveBeenCalled();
    });

    it("returns 500 without calling OpenAI when the business snapshot fails", async () => {
      happyPath();
      mocks.buildBusinessSnapshot.mockRejectedValue(
        new Error("snapshot query failed"),
      );

      const { status, body } = await callRoute();

      expect(status).toBe(500);
      expect(body).toEqual({ error: ERRORS.generationFailed });
      expect(mocks.openAIConstructor).not.toHaveBeenCalled();
      expect(mocks.responsesCreate).not.toHaveBeenCalled();
    });

    it("returns 500 when OPENAI_API_KEY is not configured", async () => {
      vi.stubEnv("OPENAI_API_KEY", undefined);
      happyPath();

      const { status, body } = await callRoute();

      expect(status).toBe(500);
      expect(body).toEqual({ error: ERRORS.generationFailed });
      expect(mocks.buildBusinessSnapshot).toHaveBeenCalledTimes(1);
      expect(mocks.openAIConstructor).not.toHaveBeenCalled();
      expect(mocks.responsesCreate).not.toHaveBeenCalled();
    });
  });
});
