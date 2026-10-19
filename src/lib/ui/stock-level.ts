// Presentation-only mapping of existing inventory facts to the four stock
// levels shown in the UI. It does not change any stock rule: the inputs are
// inventory_balances.stock_status and inventory_balances.below_minimum as
// computed by the database.
//
//   OUT_OF_STOCK   stock_status = OUT_OF_STOCK           → หมด
//   BELOW_MINIMUM  below_minimum = true                  → ต่ำกว่าขั้นต่ำ
//   NEAR_REORDER   stock_status = LOW_STOCK              → ใกล้จุดสั่งซื้อ
//   NORMAL         stock_status = NORMAL                 → ปกติ

export const STOCK_LEVELS = [
  "OUT_OF_STOCK",
  "BELOW_MINIMUM",
  "NEAR_REORDER",
  "NORMAL",
] as const;

export type StockLevel = (typeof STOCK_LEVELS)[number];

export const STOCK_LEVEL_LABELS: Record<StockLevel, string> = {
  OUT_OF_STOCK: "หมด",
  BELOW_MINIMUM: "ต่ำกว่าขั้นต่ำ",
  NEAR_REORDER: "ใกล้จุดสั่งซื้อ",
  NORMAL: "ปกติ",
};

/**
 * Most severe level first. An unrecognised status is treated as needing
 * attention rather than hidden as normal.
 */
export function stockLevel(
  stockStatus: string | null | undefined,
  belowMinimum?: boolean | null,
): StockLevel {
  if (stockStatus === "OUT_OF_STOCK") {
    return "OUT_OF_STOCK";
  }

  if (belowMinimum === true) {
    return "BELOW_MINIMUM";
  }

  if (stockStatus === "LOW_STOCK") {
    return "NEAR_REORDER";
  }

  if (stockStatus === "NORMAL") {
    return "NORMAL";
  }

  return "OUT_OF_STOCK";
}

/** 0 = most severe. Use for sorting attention lists. */
export function stockLevelSeverity(level: StockLevel): number {
  return STOCK_LEVELS.indexOf(level);
}

export function needsAttention(level: StockLevel): boolean {
  return level !== "NORMAL";
}
