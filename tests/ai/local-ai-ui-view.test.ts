import { describe, expect, it } from "vitest";

import { LOCAL_AI_SIGNALS } from "@/lib/ai/local/digest";
import {
  LOCAL_AI_FAILURE_MESSAGES,
  LOCAL_AI_SIGNAL_LABELS,
  LOCAL_AI_STOCK_STATUS_LABELS,
  buildAttentionRows,
  buildFactRows,
  buildLocalAiFooter,
  describeLocalAiAvailability,
  describeLocalAiFailure,
  describeOpenPurchaseOrder,
  describeReorderPosition,
  describeServerDataLimit,
  formatGeneratedAt,
  formatQuantity,
  formatSignedQuantity,
  otherFactItems,
  parseLocalAiSummaryResponse,
  roundQuantity,
} from "@/lib/ai/local/ui-view";
import { SERVER_DATA_LIMITS } from "@/lib/ai/local/validate";
import { STOCK_STATUSES } from "@/lib/ai/snapshot/facts";

import {
  INJECTED_TEXT,
  basilFacts,
  chickenFacts,
  summaryFixture,
  summaryWithUnknownFields,
} from "./support/local-ui-fixtures";

describe("parseLocalAiSummaryResponse", () => {
  it("accepts a contract-valid response", () => {
    expect(parseLocalAiSummaryResponse(summaryFixture())).toEqual(
      summaryFixture(),
    );
  });

  it("12. strips unknown fields at every level", () => {
    const parsed = parseLocalAiSummaryResponse(
      summaryWithUnknownFields(),
    );

    expect(parsed).toEqual(summaryFixture());

    const serialized = JSON.stringify(parsed);

    for (const text of Object.values(INJECTED_TEXT)) {
      expect(serialized).not.toContain(text);
    }

    expect(serialized).not.toContain("11434");
  });

  it.each([
    ["null", null],
    ["a string", "ok"],
    ["an error body", { code: "OLLAMA_TIMEOUT", error: "x" }],
    [
      "a non-Ollama provider",
      {
        ...summaryFixture(),
        meta: {
          ...summaryFixture().meta,
          provider: "openai",
          model: "gpt-6.1-sol",
        },
      },
    ],
    [
      "an unknown signal",
      {
        ...summaryFixture(),
        result: {
          ...summaryFixture().result,
          attention: [
            { sku: "CHICKEN-BREAST", signal: "PANIC", note: "x" },
          ],
        },
      },
    ],
    [
      "a numeric fact sent as text",
      {
        ...summaryFixture(),
        facts: {
          ...summaryFixture().facts,
          items: [{ ...chickenFacts(), current_quantity: "11700" }],
        },
      },
    ],
  ])("rejects %s", (_label, body) => {
    expect(parseLocalAiSummaryResponse(body)).toBeNull();
  });
});

describe("describeLocalAiFailure", () => {
  it.each([
    [404, LOCAL_AI_FAILURE_MESSAGES.DISABLED],
    [401, LOCAL_AI_FAILURE_MESSAGES.UNAUTHENTICATED],
    [403, LOCAL_AI_FAILURE_MESSAGES.FORBIDDEN],
    [429, LOCAL_AI_FAILURE_MESSAGES.BUSY],
    [503, LOCAL_AI_FAILURE_MESSAGES.UNREACHABLE],
    [504, LOCAL_AI_FAILURE_MESSAGES.TIMEOUT],
    [502, LOCAL_AI_FAILURE_MESSAGES.LOCAL_AI_FAILED],
    [500, LOCAL_AI_FAILURE_MESSAGES.SYSTEM],
    [418, LOCAL_AI_FAILURE_MESSAGES.SYSTEM],
    [null, LOCAL_AI_FAILURE_MESSAGES.NETWORK],
  ])("maps %s to a fixed message", (status, message) => {
    expect(describeLocalAiFailure(status).message).toBe(message);
  });

  it("uses the exact required Thai messages", () => {
    expect(describeLocalAiFailure(404).message).toBe(
      "Local AI ยังไม่ได้เปิดใช้งานบนเครื่องนี้",
    );
    expect(describeLocalAiFailure(429).message).toBe(
      "Local AI กำลังวิเคราะห์คำขอก่อนหน้า กรุณารอสักครู่",
    );
    expect(describeLocalAiFailure(503).message).toBe(
      "ไม่สามารถเชื่อมต่อ Local AI ได้ กรุณาตรวจสอบ Ollama",
    );
    expect(describeLocalAiFailure(504).message).toBe(
      "Local AI ใช้เวลานานเกินไป กรุณาลองใหม่",
    );
  });

  it("offers sign-in only for 401", () => {
    expect(describeLocalAiFailure(401).signIn).toBe(true);

    for (const status of [null, 403, 404, 429, 500, 502, 503, 504]) {
      expect(describeLocalAiFailure(status).signIn).toBe(false);
    }
  });

  it("describes availability without contacting the server", () => {
    expect(describeLocalAiAvailability("enabled")).toBeNull();
    expect(describeLocalAiAvailability("disabled")).toContain(
      LOCAL_AI_FAILURE_MESSAGES.DISABLED,
    );
    expect(describeLocalAiAvailability("misconfigured")).toBe(
      LOCAL_AI_FAILURE_MESSAGES.MISCONFIGURED,
    );
  });
});

describe("labels", () => {
  it("has a Thai label for every signal, status and data limit", () => {
    for (const signal of LOCAL_AI_SIGNALS) {
      expect(LOCAL_AI_SIGNAL_LABELS[signal]).toMatch(/\S/);
      expect(LOCAL_AI_SIGNAL_LABELS[signal]).not.toBe(signal);
    }

    for (const status of STOCK_STATUSES) {
      expect(LOCAL_AI_STOCK_STATUS_LABELS[status]).toMatch(/\S/);
    }

    const facts = summaryFixture().facts;

    for (const limit of SERVER_DATA_LIMITS) {
      const text = describeServerDataLimit(limit, facts);

      expect(text).toMatch(/\S/);
      expect(text).not.toContain(limit);
    }
  });

  it("5. maps the required data limits to Thai", () => {
    const facts = summaryFixture().facts;

    expect(describeServerDataLimit("USAGE_RATE_UNAVAILABLE", facts)).toBe(
      "ยังไม่มีข้อมูลอัตราการใช้สินค้าเพียงพอ",
    );
    expect(describeServerDataLimit("FORECAST_UNAVAILABLE", facts)).toBe(
      "ยังไม่สามารถคาดการณ์วันที่ Stock จะหมดได้",
    );
  });

  it("5. takes the omitted count from facts.data_quality", () => {
    const facts = summaryFixture().facts;

    expect(
      describeServerDataLimit("ITEMS_OMITTED", {
        ...facts,
        data_quality: { ...facts.data_quality, omitted_count: 3 },
      }),
    ).toContain("อีก 3 รายการ");

    expect(
      describeServerDataLimit("ITEMS_OMITTED", facts),
    ).not.toMatch(/[0-9]/);
  });
});

describe("numbers from facts", () => {
  it("formats quantities in th-TH with the unit", () => {
    expect(formatQuantity(11700, "g")).toBe("11,700 g");
    expect(formatQuantity(1.23456, "kg")).toBe("1.2346 kg");
    expect(formatQuantity(0, "g")).toBe("0 g");
    expect(formatQuantity(-0, "g")).toBe("0 g");
    expect(formatQuantity(5, "")).toBe("5");
  });

  it("rounds away binary noise and negative zero", () => {
    expect(roundQuantity(0.3 - 0.1)).toBe(0.2);
    expect(Object.is(roundQuantity(-0.00001), 0)).toBe(true);
  });

  it("signs adjustments", () => {
    expect(formatSignedQuantity(150, "g")).toBe("+150 g");
    expect(formatSignedQuantity(-150, "g")).toBe("-150 g");
    expect(formatSignedQuantity(0, "g")).toBe("0 g");
  });

  it("3. computes the reorder position from facts", () => {
    expect(describeReorderPosition(chickenFacts())).toEqual({
      relation: "above",
      text: "สูงกว่าจุดสั่งซื้อ 4,700 g",
    });

    expect(describeReorderPosition(basilFacts())).toEqual({
      relation: "below",
      text: "ต่ำกว่าจุดสั่งซื้อ 200 g",
    });

    expect(
      describeReorderPosition(
        chickenFacts({ current_quantity: 7000 }),
      ),
    ).toEqual({ relation: "equal", text: "เท่ากับจุดสั่งซื้อ" });

    expect(
      describeReorderPosition(
        chickenFacts({ current_quantity: 0.3, reorder_point: 0.1 }),
      ).text,
    ).toBe("สูงกว่าจุดสั่งซื้อ 0.2 g");
  });

  it("3. lists current, reorder point, minimum and waste from facts", () => {
    expect(buildFactRows(chickenFacts(), 7)).toEqual([
      { label: "สถานะ", value: "ปกติ" },
      { label: "คงเหลือ", value: "11,700 g" },
      { label: "จุดสั่งซื้อ", value: "7,000 g" },
      { label: "ขั้นต่ำ", value: "3,000 g" },
      { label: "ของเสีย 7 วัน", value: "600 g" },
    ]);

    expect(buildFactRows(basilFacts(), 7)).toContainEqual({
      label: "ปรับยอด 7 วัน",
      value: "-150 g",
    });
  });

  it("describes open purchase orders from facts", () => {
    expect(describeOpenPurchaseOrder(chickenFacts())).toBeNull();
    expect(describeOpenPurchaseOrder(basilFacts())).toBe(
      "มี PO ค้างรับ 2,000 g เมื่อรับครบจะสูงกว่าจุดสั่งซื้อ",
    );
    expect(
      describeOpenPurchaseOrder(
        basilFacts({ reorder_covered_by_open_po: false }),
      ),
    ).toBe("มี PO ค้างรับ 2,000 g แต่ยังไม่พอให้สูงกว่าจุดสั่งซื้อ");
    expect(
      describeOpenPurchaseOrder(
        chickenFacts({ open_po_remaining_quantity: 500 }),
      ),
    ).toBe("มี PO ค้างรับ 500 g");
  });
});

describe("attention rows", () => {
  it("2. resolves the SKU to the item name from facts", () => {
    const [row] = buildAttentionRows(summaryFixture());

    expect(row).toMatchObject({
      sku: "CHICKEN-BREAST",
      name: "อกไก่",
      signal: "WASTE",
      signalLabel: "มีของเสีย",
      item: chickenFacts(),
    });
  });

  it("falls back to the SKU when facts have no such item", () => {
    const summary = summaryFixture();
    summary.result.attention = [
      { sku: "UNKNOWN-SKU", signal: "LOW_STOCK", note: "x" },
    ];

    expect(buildAttentionRows(summary)[0]).toMatchObject({
      name: "UNKNOWN-SKU",
      item: null,
    });
  });

  it("13. keeps model prose verbatim and never derives facts from it", () => {
    const summary = summaryFixture();
    summary.result.attention = [
      {
        sku: "CHICKEN-BREAST",
        signal: "LOW_STOCK",
        note: "เหลือ 5 g ต่ำกว่าจุดสั่งซื้อ 9,999 g",
      },
    ];

    const [row] = buildAttentionRows(summary);

    expect(row.note).toBe("เหลือ 5 g ต่ำกว่าจุดสั่งซื้อ 9,999 g");
    expect(row.item).toEqual(chickenFacts());
    expect(describeReorderPosition(row.item!).text).toBe(
      "สูงกว่าจุดสั่งซื้อ 4,700 g",
    );
  });

  it("lists facts items the model did not mention", () => {
    expect(otherFactItems(summaryFixture())).toEqual([basilFacts()]);
  });
});

describe("footer", () => {
  it("11. names Local AI, the Ollama model and on-device processing", () => {
    const footer = buildLocalAiFooter(summaryFixture().meta);

    expect(footer).toBe(
      `Local AI · qwen3.5:4b · ประมวลผลบนเครื่อง · ${formatGeneratedAt(
        summaryFixture().meta.generated_at,
      )}`,
    );
    expect(footer).toContain("14:05");
    expect(footer).not.toContain("gpt");
  });

  it("omits an unreadable timestamp", () => {
    expect(
      buildLocalAiFooter({
        ...summaryFixture().meta,
        generated_at: "not-a-date",
      }),
    ).toBe("Local AI · qwen3.5:4b · ประมวลผลบนเครื่อง");
  });
});
