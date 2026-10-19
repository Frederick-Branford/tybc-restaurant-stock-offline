import { describe, expect, it } from "vitest";

import {
  STOCK_LEVEL_LABELS,
  STOCK_LEVELS,
  needsAttention,
  stockLevel,
  stockLevelSeverity,
} from "@/lib/ui/stock-level";

describe("stockLevel (presentation mapping of DB facts)", () => {
  it("maps database stock_status and below_minimum to the four UI levels", () => {
    expect(stockLevel("NORMAL", false)).toBe("NORMAL");
    expect(stockLevel("LOW_STOCK", false)).toBe("NEAR_REORDER");
    expect(stockLevel("LOW_STOCK", true)).toBe("BELOW_MINIMUM");
    expect(stockLevel("OUT_OF_STOCK", true)).toBe("OUT_OF_STOCK");
    expect(stockLevel("OUT_OF_STOCK", false)).toBe("OUT_OF_STOCK");
  });

  it("never hides below-minimum stock as normal", () => {
    expect(stockLevel("NORMAL", true)).toBe("BELOW_MINIMUM");
  });

  it("treats a missing below_minimum as false", () => {
    expect(stockLevel("LOW_STOCK")).toBe("NEAR_REORDER");
    expect(stockLevel("NORMAL", null)).toBe("NORMAL");
  });

  it("treats an unknown status as needing attention", () => {
    expect(stockLevel("SOMETHING_NEW", false)).toBe("OUT_OF_STOCK");
    expect(stockLevel(undefined)).toBe("OUT_OF_STOCK");
  });

  it("uses the agreed Thai labels", () => {
    expect(STOCK_LEVEL_LABELS).toEqual({
      OUT_OF_STOCK: "หมด",
      BELOW_MINIMUM: "ต่ำกว่าขั้นต่ำ",
      NEAR_REORDER: "ใกล้จุดสั่งซื้อ",
      NORMAL: "ปกติ",
    });
  });

  it("orders severity from out of stock to normal", () => {
    const sorted = [...STOCK_LEVELS].sort(
      (a, b) => stockLevelSeverity(a) - stockLevelSeverity(b),
    );

    expect(sorted).toEqual([
      "OUT_OF_STOCK",
      "BELOW_MINIMUM",
      "NEAR_REORDER",
      "NORMAL",
    ]);
    expect(needsAttention("NORMAL")).toBe(false);
    expect(needsAttention("NEAR_REORDER")).toBe(true);
  });
});
