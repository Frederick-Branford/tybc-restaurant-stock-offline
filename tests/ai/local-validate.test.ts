import { describe, expect, it } from "vitest";

import {
  buildLocalDigest,
  type LocalDigest,
} from "@/lib/ai/local/digest";

import {
  containsNumericClaim,
  validateLocalAiOutput,
  type LocalAiValidationResult,
  type ValidatedLocalAiOutput,
} from "@/lib/ai/local/validate";

import { deriveBusinessSnapshotV2 } from "@/lib/ai/snapshot/facts";

import {
  deepFreeze,
  snapshotFor,
  sourceFor,
  type ItemSpec,
} from "./support/local-fixtures";

import {
  inventoryRow,
  snapshotSource,
} from "./support/snapshot-fixtures";

// Digest items (ranked):
// MILK-1L        OUT_OF_STOCK, BELOW_MINIMUM
// CHICKEN-BREAST LOW_STOCK, WASTE
// EGG            ADJUSTMENT
function digest(): LocalDigest {
  return buildLocalDigest(
    snapshotFor([
      {
        sku: "CHICKEN-BREAST",
        status: "LOW_STOCK",
        waste: 1100,
        openPo: 5000,
      },
      { sku: "MILK-1L", status: "OUT_OF_STOCK" },
      { sku: "EGG", adjustment: -5 },
      { sku: "RICE" },
    ]),
  );
}

type Entry = { sku: string; signal: string; note: string };

function output(
  overrides: Partial<{
    overview: string;
    attention: Entry[];
    actions: string[];
  }> = {},
) {
  return {
    overview: "มีวัตถุดิบบางรายการที่ควรตรวจสอบ",
    attention: [
      {
        sku: "CHICKEN-BREAST",
        signal: "LOW_STOCK",
        note: "ตรวจสอบการเติมสต็อก",
      },
    ],
    actions: ["ตรวจสอบการจัดเก็บวัตถุดิบ"],
    ...overrides,
  };
}

function valid(
  result: LocalAiValidationResult,
): ValidatedLocalAiOutput {
  if (!result.ok) {
    throw new Error(
      `expected valid output: ${result.issues.join("; ")}`,
    );
  }

  return result.value;
}

function run(
  overrides: Parameters<typeof output>[0] = {},
  digestValue: LocalDigest = digest(),
): ValidatedLocalAiOutput {
  return valid(
    validateLocalAiOutput({
      output: output(overrides),
      digest: digestValue,
    }),
  );
}

describe("Local AI semantic validation: attention", () => {
  it("28. keeps a valid SKU + signal", () => {
    const result = run();

    expect(result.attention).toEqual([
      {
        sku: "CHICKEN-BREAST",
        signal: "LOW_STOCK",
        note: "ตรวจสอบการเติมสต็อก",
      },
    ]);
    expect(result.dropped).toEqual([]);
  });

  it("20/29. removes an unknown SKU", () => {
    const result = run({
      attention: [
        { sku: "LOBSTER", signal: "LOW_STOCK", note: "สั่งเพิ่ม" },
        {
          sku: "chicken-breast",
          signal: "LOW_STOCK",
          note: "ตัวพิมพ์เล็กไม่ใช่ SKU เดียวกัน",
        },
      ],
    });

    expect(result.attention).toEqual([]);
    expect(result.dropped).toEqual([
      { field: "attention", index: 0, reason: "UNKNOWN_SKU" },
      { field: "attention", index: 1, reason: "UNKNOWN_SKU" },
    ]);
  });

  it("removes a SKU that exists in the snapshot but was not sent in the digest", () => {
    const result = run({
      attention: [
        { sku: "RICE", signal: "WASTE", note: "ตรวจสอบ" },
      ],
    });

    expect(result.attention).toEqual([]);
    expect(result.dropped[0].reason).toBe("UNKNOWN_SKU");
  });

  it("21/30. removes a signal the SKU does not have", () => {
    const result = run({
      attention: [
        {
          sku: "CHICKEN-BREAST",
          signal: "OUT_OF_STOCK",
          note: "ตรวจสอบของหมด",
        },
      ],
    });

    expect(result.attention).toEqual([]);
    expect(result.dropped).toEqual([
      {
        field: "attention",
        index: 0,
        reason: "SIGNAL_NOT_IN_DIGEST",
      },
    ]);
  });

  it("22/31. de-duplicates SKU + signal, keeping the first accepted entry", () => {
    const result = run({
      attention: [
        { sku: "EGG", signal: "ADJUSTMENT", note: "ครั้งแรก" },
        { sku: "EGG", signal: "ADJUSTMENT", note: "ครั้งที่สอง" },
      ],
    });

    expect(result.attention).toEqual([
      { sku: "EGG", signal: "ADJUSTMENT", note: "ครั้งแรก" },
    ]);
    expect(result.dropped).toEqual([
      { field: "attention", index: 1, reason: "DUPLICATE" },
    ]);
  });

  it.each<[string, Entry[]]>([
    [
      "CHICKEN-BREAST",
      [
        {
          sku: "CHICKEN-BREAST",
          signal: "LOW_STOCK",
          note: "ตรวจสอบการเติมสต็อก",
        },
        {
          sku: "CHICKEN-BREAST",
          signal: "WASTE",
          note: "ตรวจสอบสาเหตุของของเสีย",
        },
      ],
    ],
    [
      "MILK-1L",
      [
        {
          sku: "MILK-1L",
          signal: "OUT_OF_STOCK",
          note: "ตรวจสอบการสั่งซื้อ",
        },
        {
          sku: "MILK-1L",
          signal: "BELOW_MINIMUM",
          note: "ตรวจสอบระดับขั้นต่ำ",
        },
      ],
    ],
  ])("32. keeps several valid signals on the same SKU (%s)", (_sku, attention) => {
    const result = run({ attention });

    expect(result.attention).toEqual(attention);
    expect(result.dropped).toEqual([]);
  });

  it.each<[Entry[]]>([
    [
      [
        { sku: "EGG", signal: "OUT_OF_STOCK", note: "ไข่หมด" },
        { sku: "EGG", signal: "LOW_STOCK", note: "ไข่ใกล้หมด" },
      ],
    ],
    [
      [
        {
          sku: "MILK-1L",
          signal: "LOW_STOCK",
          note: "ผิดสถานะ",
        },
        {
          sku: "CHICKEN-BREAST",
          signal: "ADJUSTMENT",
          note: "ไม่มีการปรับยอด",
        },
      ],
    ],
  ])("33. cannot create a signal that is not in the digest (%#)", (attention) => {
    const result = run({ attention });

    expect(result.attention).toEqual([]);
    expect(
      result.dropped.map((entry) => entry.reason),
    ).toEqual([
      "SIGNAL_NOT_IN_DIGEST",
      "SIGNAL_NOT_IN_DIGEST",
    ]);
  });

  it("trims SKU and text, and drops text that is empty after trimming", () => {
    const result = run({
      overview: "  ภาพรวมปกติ  ",
      attention: [
        { sku: " EGG ", signal: "ADJUSTMENT", note: "  ตรวจนับ  " },
        { sku: "MILK-1L", signal: "OUT_OF_STOCK", note: "   " },
      ],
      actions: ["  ตรวจนับสต็อก  ", " "],
    });

    expect(result.overview).toBe("ภาพรวมปกติ");
    expect(result.attention).toEqual([
      { sku: "EGG", signal: "ADJUSTMENT", note: "ตรวจนับ" },
    ]);
    expect(result.actions).toEqual(["ตรวจนับสต็อก"]);
    expect(result.dropped).toEqual([
      { field: "attention", index: 1, reason: "EMPTY_TEXT" },
      { field: "actions", index: 1, reason: "EMPTY_TEXT" },
    ]);
  });
});

describe("Local AI semantic validation: numeric-text policy", () => {
  it("13/34. drops an attention entry whose note makes a numeric claim and keeps the rest", () => {
    const result = run({
      attention: [
        {
          sku: "CHICKEN-BREAST",
          signal: "WASTE",
          note: "ของเสีย 1100 กรัม",
        },
        {
          sku: "CHICKEN-BREAST",
          signal: "LOW_STOCK",
          note: "ตรวจสอบการเติมสต็อก",
        },
      ],
    });

    expect(result.attention).toEqual([
      {
        sku: "CHICKEN-BREAST",
        signal: "LOW_STOCK",
        note: "ตรวจสอบการเติมสต็อก",
      },
    ]);
    expect(result.dropped).toEqual([
      { field: "attention", index: 0, reason: "NUMERIC_CLAIM" },
    ]);
  });

  it("35. treats Thai digits as numeric claims", () => {
    const result = run({
      attention: [
        {
          sku: "MILK-1L",
          signal: "OUT_OF_STOCK",
          note: "จะหมดใน ๓ วัน",
        },
      ],
      actions: ["สั่งเพิ่ม ๕ ลัง"],
    });

    expect(result.attention).toEqual([]);
    expect(result.actions).toEqual([]);
    expect(
      result.dropped.map((entry) => entry.reason),
    ).toEqual(["NUMERIC_CLAIM", "NUMERIC_CLAIM"]);
  });

  it("18. allows digits that are part of a SKU from the digest", () => {
    const result = run({
      attention: [
        {
          sku: "MILK-1L",
          signal: "OUT_OF_STOCK",
          note: "ตรวจสอบการสั่ง MILK-1L",
        },
      ],
    });

    expect(result.attention).toHaveLength(1);
    expect(result.dropped).toEqual([]);
  });

  it("still catches a number next to an allowed SKU", () => {
    const result = run({
      attention: [
        {
          sku: "MILK-1L",
          signal: "OUT_OF_STOCK",
          note: "MILK-1L ขาด 24 กล่อง",
        },
      ],
    });

    expect(result.attention).toEqual([]);
  });

  it("14. replaces an overview with a numeric claim by null and keeps the rest", () => {
    const result = run({
      overview: "มี 3 รายการที่ต้องสั่งซื้อ",
    });

    expect(result.overview).toBeNull();
    expect(result.attention).toHaveLength(1);
    expect(result.dropped).toEqual([
      { field: "overview", index: 0, reason: "NUMERIC_CLAIM" },
    ]);
  });

  it("15. drops a numeric action individually", () => {
    const result = run({
      actions: [
        "ตรวจสอบตู้เย็น",
        "สั่งซื้อภายใน 2 วัน",
      ],
    });

    expect(result.actions).toEqual(["ตรวจสอบตู้เย็น"]);
    expect(result.dropped).toEqual([
      { field: "actions", index: 1, reason: "NUMERIC_CLAIM" },
    ]);
  });

  it("does not flag text without decimal digits", () => {
    expect(
      containsNumericClaim(
        "สต็อกต่ำ — ควรตรวจสอบ (หมายเหตุ) ½ ² ✓",
        [],
      ),
    ).toBe(false);
    expect(containsNumericClaim("ten bags", [])).toBe(false);
    expect(containsNumericClaim("１０ ถุง", [])).toBe(true);
    expect(containsNumericClaim("10", [])).toBe(true);
    expect(containsNumericClaim("๑๐", [])).toBe(true);
  });

  it("de-duplicates identical actions", () => {
    const result = run({
      actions: ["ตรวจนับสต็อก", "ตรวจนับสต็อก"],
    });

    expect(result.actions).toEqual(["ตรวจนับสต็อก"]);
    expect(result.dropped).toEqual([
      { field: "actions", index: 1, reason: "DUPLICATE" },
    ]);
  });
});

describe("Local AI semantic validation: server-owned data limits", () => {
  function limitsFor(
    specs: ItemSpec[],
    datasets: Parameters<typeof sourceFor>[1] = {},
  ) {
    return run(
      { attention: [] },
      buildLocalDigest(snapshotFor(specs, datasets)),
    ).server_data_limits;
  }

  it("8/11/12. produces server_data_limits; usage rate and forecast are always unavailable", () => {
    expect(limitsFor([{ sku: "A", status: "LOW_STOCK" }])).toEqual([
      "USAGE_RATE_UNAVAILABLE",
      "FORECAST_UNAVAILABLE",
    ]);
  });

  it("9. incomplete data survives as DATA_INCOMPLETE", () => {
    expect(
      limitsFor([{ sku: "A", status: "LOW_STOCK" }], {
        datasets: {
          purchase_order_lines: {
            expected_rows: null,
            rows_read: 0,
            complete: false,
            incomplete_reason: "COUNT_UNAVAILABLE",
          },
        },
      }),
    ).toEqual([
      "DATA_INCOMPLETE",
      "USAGE_RATE_UNAVAILABLE",
      "FORECAST_UNAVAILABLE",
    ]);
  });

  it("10. omitted items survive as ITEMS_OMITTED", () => {
    expect(
      limitsFor(
        Array.from({ length: 12 }, (_, index) => ({
          sku: `LOW-${String(index).padStart(2, "0")}`,
          status: "LOW_STOCK" as const,
        })),
      ),
    ).toEqual([
      "ITEMS_OMITTED",
      "USAGE_RATE_UNAVAILABLE",
      "FORECAST_UNAVAILABLE",
    ]);
  });

  it("an inconsistent DB stock status survives as STOCK_STATUS_INCONSISTENT", () => {
    const inconsistent = buildLocalDigest(
      deriveBusinessSnapshotV2(
        snapshotSource({
          inventory: [
            inventoryRow({
              current_quantity: 6500,
              stock_status: "NORMAL",
            }),
          ],
        }),
      ),
    );

    expect(
      run({ attention: [] }, inconsistent).server_data_limits,
    ).toContain("STOCK_STATUS_INCONSISTENT");
  });

  it("7. the model cannot add or remove data limits: data_limits is rejected", () => {
    const result = validateLocalAiOutput({
      output: {
        ...output(),
        data_limits: ["ข้อมูลครบถ้วนทุกอย่าง มีการคาดการณ์แล้ว"],
      },
      digest: digest(),
    });

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.reason).toBe("SCHEMA_INVALID");
    }
  });

  it("validated output has exactly overview, attention, actions, server_data_limits, dropped", () => {
    expect(Object.keys(run()).sort()).toEqual([
      "actions",
      "attention",
      "dropped",
      "overview",
      "server_data_limits",
    ]);
  });

  it("rejects output that does not match the schema", () => {
    const result = validateLocalAiOutput({
      output: { ...output(), reorder_required: false },
      digest: digest(),
    });

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.reason).toBe("SCHEMA_INVALID");
      expect(result.issues.length).toBeGreaterThan(0);
    }

    expect(
      validateLocalAiOutput({
        output: "not json",
        digest: digest(),
      }).ok,
    ).toBe(false);
  });

  it("36. does not mutate its inputs", () => {
    const frozenDigest = deepFreeze(digest());
    const frozenOutput = deepFreeze(
      output({
        attention: [
          {
            sku: " EGG ",
            signal: "ADJUSTMENT",
            note: " ตรวจนับ ",
          },
          { sku: "LOBSTER", signal: "WASTE", note: "ไม่มี" },
        ],
      }),
    );

    const digestBefore = JSON.stringify(frozenDigest);
    const outputBefore = JSON.stringify(frozenOutput);

    const result = valid(
      validateLocalAiOutput({
        output: frozenOutput,
        digest: frozenDigest,
      }),
    );

    expect(JSON.stringify(frozenDigest)).toBe(digestBefore);
    expect(JSON.stringify(frozenOutput)).toBe(outputBefore);
    expect(result.attention[0]).not.toBe(
      frozenOutput.attention[0],
    );
  });

  it("is deterministic for the same output and digest", () => {
    const input = output({
      overview: "มี 2 รายการ",
      attention: [
        { sku: "EGG", signal: "ADJUSTMENT", note: "ก" },
        { sku: "LOBSTER", signal: "WASTE", note: "ค" },
      ],
    });

    expect(
      JSON.stringify(
        validateLocalAiOutput({ output: input, digest: digest() }),
      ),
    ).toBe(
      JSON.stringify(
        validateLocalAiOutput({ output: input, digest: digest() }),
      ),
    );
  });
});
