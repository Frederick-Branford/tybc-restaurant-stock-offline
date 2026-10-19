// Business Snapshot V2: deterministic fact layer.
//
// Pure transformation from database rows to facts. No I/O, no Supabase,
// no clock, no randomness. The same input always produces the same output,
// byte for byte, regardless of input row order.
//
// The database stays authoritative:
// - current_quantity, minimum_stock, reorder_point, stock_status and
//   below_minimum are passed through from the inventory_balances view.
// - Everything else is derived here with fixed rules, so a language model
//   never has to calculate stock state.
//
// Quantities are only aggregated per item, in that item's base unit.
// Nothing in this module adds quantities across items.

import { z } from "zod";

// ============================================================
// Constants (mirror database CHECK constraints and enums)
// ============================================================

export const SNAPSHOT_V2_VERSION = 2;

export const MOVEMENT_WINDOW_DAYS = 7;

export const STOCK_STATUSES = [
  "NORMAL",
  "LOW_STOCK",
  "OUT_OF_STOCK",
] as const;

export const MOVEMENT_TYPES = [
  "OPENING_BALANCE",
  "STOCK_IN",
  "STOCK_OUT",
  "WASTE",
  "COUNT_ADJUSTMENT",
  "MANUAL_ADJUSTMENT",
  "PO_RECEIVE",
  "POS_DEDUCTION",
  "RETURN_IN",
  "RETURN_OUT",
] as const;

export const PURCHASE_ORDER_STATUSES = [
  "DRAFT",
  "ORDERED",
  "PARTIALLY_RECEIVED",
  "RECEIVED",
  "CANCELLED",
] as const;

// Ordered with the supplier and not yet fully received or cancelled.
export const OPEN_PURCHASE_ORDER_STATUSES = [
  "ORDERED",
  "PARTIALLY_RECEIVED",
] as const;

export type StockStatus =
  (typeof STOCK_STATUSES)[number];

export type MovementType =
  (typeof MOVEMENT_TYPES)[number];

export type PurchaseOrderStatus =
  (typeof PURCHASE_ORDER_STATUSES)[number];

type MovementBucket =
  | "stock_in"
  | "stock_out"
  | "waste"
  | "po_receive"
  | "adjustment";

// Same classification as Snapshot V1.
const MOVEMENT_BUCKETS: Record<
  MovementType,
  MovementBucket
> = {
  OPENING_BALANCE: "stock_in",
  STOCK_IN: "stock_in",
  RETURN_IN: "stock_in",
  STOCK_OUT: "stock_out",
  POS_DEDUCTION: "stock_out",
  RETURN_OUT: "stock_out",
  WASTE: "waste",
  PO_RECEIVE: "po_receive",
  COUNT_ADJUSTMENT: "adjustment",
  MANUAL_ADJUSTMENT: "adjustment",
};

// ============================================================
// Fixed-point arithmetic
//
// Quantities are numeric(18,4) in PostgreSQL. They are summed as integers
// in ten-thousandths so results are exact and deterministic
// (no 0.1 + 0.2 drift).
// ============================================================

const QUANTITY_SCALE = 10_000;

function toScaled(value: number | string): number {
  const scaled = Math.round(
    Number(value) * QUANTITY_SCALE,
  );

  if (!Number.isSafeInteger(scaled)) {
    throw new Error(
      `Quantity is out of the supported range: ${String(value)}`,
    );
  }

  return scaled;
}

function fromScaled(scaled: number): number {
  return scaled / QUANTITY_SCALE + 0;
}

function compareText(a: string, b: string): number {
  if (a < b) {
    return -1;
  }

  if (a > b) {
    return 1;
  }

  return 0;
}

// ============================================================
// Input schemas (rows read from the database)
// ============================================================

// PostgREST returns numeric as a JSON number; accept decimal strings too.
const dbNumericSchema = z.union([
  z.number(),
  z.string().regex(/^-?\d+(\.\d+)?$/),
]);

export const inventoryBalanceRowSchema = z.object({
  item_id: z.string().min(1),
  sku: z.string().min(1),
  name: z.string(),
  base_unit_id: z.string().min(1),
  base_unit_code: z.string(),
  base_unit_symbol: z.string(),
  current_quantity: dbNumericSchema,
  minimum_stock: dbNumericSchema,
  reorder_point: dbNumericSchema,
  stock_status: z.enum(STOCK_STATUSES),
  below_minimum: z.boolean(),
  is_active: z.boolean(),
});

export const stockMovementRowSchema = z.object({
  id: z.string().min(1),
  item_id: z.string().min(1),
  movement_type: z.enum(MOVEMENT_TYPES),
  base_quantity: dbNumericSchema,
  base_unit_id: z.string().min(1),
  reason_code: z.string().nullable(),
  occurred_at: z.string(),
});

export const purchaseOrderRowSchema = z.object({
  id: z.string().min(1),
  status: z.enum(PURCHASE_ORDER_STATUSES),
});

export const purchaseOrderLineRowSchema = z.object({
  id: z.string().min(1),
  purchase_order_id: z.string().min(1),
  item_id: z.string().min(1),
  ordered_base_quantity: dbNumericSchema,
  received_base_quantity: dbNumericSchema,
  po_status: z.enum(PURCHASE_ORDER_STATUSES),
});

export const datasetReadSchema = z.object({
  expected_rows: z.number().int().nonnegative().nullable(),
  rows_read: z.number().int().nonnegative(),
  complete: z.boolean(),
  incomplete_reason: z.string().nullable(),
});

export const snapshotScopeSchema = z.object({
  type: z.literal("GLOBAL"),
});

export const snapshotSourceSchema = z.object({
  generated_at: z.string().min(1),
  scope: snapshotScopeSchema,
  window: z.object({
    days: z.literal(MOVEMENT_WINDOW_DAYS),
    since: z.string().min(1),
    until: z.string().min(1),
  }),
  inventory: z.array(inventoryBalanceRowSchema),
  movements: z.array(stockMovementRowSchema),
  purchase_orders: z.array(purchaseOrderRowSchema),
  purchase_order_lines: z.array(
    purchaseOrderLineRowSchema,
  ),
  datasets: z.object({
    inventory: datasetReadSchema,
    movements: datasetReadSchema,
    purchase_orders: datasetReadSchema,
    purchase_order_lines: datasetReadSchema,
  }),
});

export type InventoryBalanceRow = z.infer<
  typeof inventoryBalanceRowSchema
>;

export type StockMovementRow = z.infer<
  typeof stockMovementRowSchema
>;

export type PurchaseOrderRow = z.infer<
  typeof purchaseOrderRowSchema
>;

export type PurchaseOrderLineRow = z.infer<
  typeof purchaseOrderLineRowSchema
>;

export type DatasetRead = z.infer<
  typeof datasetReadSchema
>;

export type SnapshotSource = z.infer<
  typeof snapshotSourceSchema
>;

// ============================================================
// Output schema
// ============================================================

const quantitySchema = z.number();

const nonNegativeQuantitySchema = z.number().nonnegative();

const countSchema = z.number().int().nonnegative();

export const itemFactsSchema = z.object({
  item_id: z.string(),
  sku: z.string(),
  name: z.string(),
  is_active: z.boolean(),

  unit: z.object({
    id: z.string(),
    code: z.string(),
    symbol: z.string(),
  }),

  // From the database (authoritative).
  current_quantity: quantitySchema,
  minimum_stock: nonNegativeQuantitySchema,
  reorder_point: nonNegativeQuantitySchema,
  stock_status: z.enum(STOCK_STATUSES),
  below_minimum: z.boolean(),

  // Derived reorder facts.
  reorder_required: z.boolean(),
  quantity_above_reorder: nonNegativeQuantitySchema,
  quantity_below_reorder: nonNegativeQuantitySchema,

  // Movement facts for the window, in this item's base unit.
  stock_in_7d: nonNegativeQuantitySchema,
  stock_out_7d: nonNegativeQuantitySchema,
  waste_7d: nonNegativeQuantitySchema,
  adjustment_7d: quantitySchema,
  po_receive_7d: nonNegativeQuantitySchema,
  movement_event_count_7d: countSchema,
  waste_event_count_7d: countSchema,
  adjustment_event_count_7d: countSchema,

  // Open purchase order facts, in this item's base unit.
  open_po_count: countSchema,
  open_po_remaining_quantity: nonNegativeQuantitySchema,
  quantity_including_open_po: quantitySchema,
  reorder_covered_by_open_po: z.boolean(),

  usage_rate_available: z.literal(false),
  forecast_available: z.literal(false),
});

const movementTypeCountsSchema = z.object({
  OPENING_BALANCE: countSchema,
  STOCK_IN: countSchema,
  STOCK_OUT: countSchema,
  WASTE: countSchema,
  COUNT_ADJUSTMENT: countSchema,
  MANUAL_ADJUSTMENT: countSchema,
  PO_RECEIVE: countSchema,
  POS_DEDUCTION: countSchema,
  RETURN_IN: countSchema,
  RETURN_OUT: countSchema,
});

const purchaseOrderStatusCountsSchema = z.object({
  DRAFT: countSchema,
  ORDERED: countSchema,
  PARTIALLY_RECEIVED: countSchema,
  RECEIVED: countSchema,
  CANCELLED: countSchema,
});

export const businessSnapshotV2Schema = z.object({
  version: z.literal(SNAPSHOT_V2_VERSION),
  generated_at: z.string(),
  scope: snapshotScopeSchema,

  window: z.object({
    days: z.literal(MOVEMENT_WINDOW_DAYS),
    since: z.string(),
    until: z.string(),
  }),

  availability: z.object({
    usage_rate_available: z.literal(false),
    forecast_available: z.literal(false),
  }),

  inventory: z.object({
    totals: z.object({
      active_item_count: countSchema,
      normal_count: countSchema,
      low_stock_count: countSchema,
      out_of_stock_count: countSchema,
      below_minimum_count: countSchema,
      reorder_required_count: countSchema,
      reorder_covered_by_open_po_count: countSchema,
    }),
    items: z.array(itemFactsSchema),
  }),

  inactive_items_with_activity: z.array(itemFactsSchema),

  movements_7d: z.object({
    event_count: countSchema,
    event_counts_by_type: movementTypeCountsSchema,
    waste_reason_event_counts: z.record(
      z.string(),
      countSchema,
    ),
  }),

  purchasing: z.object({
    total_po_count: countSchema,
    status_counts: purchaseOrderStatusCountsSchema,
    open_po_count: countSchema,
    ordered_po_count: countSchema,
    partially_received_po_count: countSchema,
    received_po_count: countSchema,
    open_po_line_count: countSchema,
  }),

  data_quality: z.object({
    complete: z.boolean(),
    generated_at: z.string(),
    inventory_rows_complete: z.boolean(),
    movement_rows_complete: z.boolean(),
    purchase_order_rows_complete: z.boolean(),
    excluded_row_count: countSchema,
    excluded_rows: z.object({
      movements_unknown_item: countSchema,
      movements_unit_mismatch: countSchema,
      purchase_order_lines_unknown_item: countSchema,
    }),
    stock_status_mismatch_count: countSchema,
    datasets: z.object({
      inventory: datasetReadSchema,
      movements: datasetReadSchema,
      purchase_orders: datasetReadSchema,
      purchase_order_lines: datasetReadSchema,
    }),
  }),
});

export type ItemFacts = z.infer<typeof itemFactsSchema>;

export type BusinessSnapshotV2 = z.infer<
  typeof businessSnapshotV2Schema
>;

// ============================================================
// Derivation
// ============================================================

type ItemAccumulator = {
  stockIn: number;
  stockOut: number;
  waste: number;
  poReceive: number;
  adjustment: number;
  movementEvents: number;
  wasteEvents: number;
  adjustmentEvents: number;
  openPoCount: number;
  openPoRemaining: number;
};

function emptyAccumulator(): ItemAccumulator {
  return {
    stockIn: 0,
    stockOut: 0,
    waste: 0,
    poReceive: 0,
    adjustment: 0,
    movementEvents: 0,
    wasteEvents: 0,
    adjustmentEvents: 0,
    openPoCount: 0,
    openPoRemaining: 0,
  };
}

function expectedStockStatus(
  currentScaled: number,
  reorderScaled: number,
): StockStatus {
  // Same rule as the inventory_balances view.
  if (currentScaled <= 0) {
    return "OUT_OF_STOCK";
  }

  if (currentScaled <= reorderScaled) {
    return "LOW_STOCK";
  }

  return "NORMAL";
}

function isOpenPurchaseOrderStatus(
  status: PurchaseOrderStatus,
): boolean {
  return (
    OPEN_PURCHASE_ORDER_STATUSES as readonly PurchaseOrderStatus[]
  ).includes(status);
}

function buildItemFacts(
  row: InventoryBalanceRow,
  accumulator: ItemAccumulator,
): ItemFacts {
  const current = toScaled(row.current_quantity);
  const minimum = toScaled(row.minimum_stock);
  const reorder = toScaled(row.reorder_point);

  const reorderRequired = current <= reorder;

  const quantityAbove =
    current > reorder ? current - reorder : 0;

  const quantityBelow =
    current < reorder ? reorder - current : 0;

  const includingOpenPo =
    current + accumulator.openPoRemaining;

  // Reorder is needed, an open PO still has quantity to deliver, and
  // receiving that quantity would lift stock above the reorder point.
  // This never changes reorder_required.
  const coveredByOpenPo =
    reorderRequired &&
    accumulator.openPoRemaining > 0 &&
    includingOpenPo > reorder;

  return {
    item_id: row.item_id,
    sku: row.sku,
    name: row.name,
    is_active: row.is_active,

    unit: {
      id: row.base_unit_id,
      code: row.base_unit_code,
      symbol: row.base_unit_symbol,
    },

    current_quantity: fromScaled(current),
    minimum_stock: fromScaled(minimum),
    reorder_point: fromScaled(reorder),
    stock_status: row.stock_status,
    below_minimum: row.below_minimum,

    reorder_required: reorderRequired,
    quantity_above_reorder: fromScaled(quantityAbove),
    quantity_below_reorder: fromScaled(quantityBelow),

    stock_in_7d: fromScaled(accumulator.stockIn),
    stock_out_7d: fromScaled(accumulator.stockOut),
    waste_7d: fromScaled(accumulator.waste),
    adjustment_7d: fromScaled(accumulator.adjustment),
    po_receive_7d: fromScaled(accumulator.poReceive),
    movement_event_count_7d: accumulator.movementEvents,
    waste_event_count_7d: accumulator.wasteEvents,
    adjustment_event_count_7d:
      accumulator.adjustmentEvents,

    open_po_count: accumulator.openPoCount,
    open_po_remaining_quantity: fromScaled(
      accumulator.openPoRemaining,
    ),
    quantity_including_open_po: fromScaled(
      includingOpenPo,
    ),
    reorder_covered_by_open_po: coveredByOpenPo,

    usage_rate_available: false,
    forecast_available: false,
  };
}

function compareItems(
  a: InventoryBalanceRow,
  b: InventoryBalanceRow,
): number {
  return (
    compareText(a.sku, b.sku) ||
    compareText(a.item_id, b.item_id)
  );
}

/**
 * Derives Business Snapshot V2 facts from database rows.
 *
 * The source must already be limited to the snapshot window
 * (movements) and to the rows the I/O layer selected. Throws when the
 * source does not match the expected database contract, for example an
 * unknown movement type or stock status.
 */
export function deriveBusinessSnapshotV2(
  sourceInput: SnapshotSource,
): BusinessSnapshotV2 {
  const source = snapshotSourceSchema.parse(sourceInput);

  // Item identity covers active and inactive items. Active inventory is a
  // separate concern handled below.
  const itemsById = new Map<
    string,
    InventoryBalanceRow
  >();

  for (const row of source.inventory) {
    itemsById.set(row.item_id, row);
  }

  const accumulators = new Map<
    string,
    ItemAccumulator
  >();

  function accumulatorFor(
    itemId: string,
  ): ItemAccumulator {
    let accumulator = accumulators.get(itemId);

    if (!accumulator) {
      accumulator = emptyAccumulator();
      accumulators.set(itemId, accumulator);
    }

    return accumulator;
  }

  const eventCountsByType = Object.fromEntries(
    MOVEMENT_TYPES.map((type) => [type, 0]),
  ) as Record<MovementType, number>;

  const wasteReasonCounts = new Map<string, number>();

  let movementsUnknownItem = 0;
  let movementsUnitMismatch = 0;
  let includedMovements = 0;

  for (const movement of source.movements) {
    const item = itemsById.get(movement.item_id);

    if (!item) {
      movementsUnknownItem += 1;
      continue;
    }

    // The database already enforces this; never mix units if it ever fails.
    if (movement.base_unit_id !== item.base_unit_id) {
      movementsUnitMismatch += 1;
      continue;
    }

    const accumulator = accumulatorFor(item.item_id);
    const signed = toScaled(movement.base_quantity);
    const magnitude = Math.abs(signed);

    includedMovements += 1;
    accumulator.movementEvents += 1;
    eventCountsByType[movement.movement_type] += 1;

    switch (MOVEMENT_BUCKETS[movement.movement_type]) {
      case "stock_in":
        accumulator.stockIn += magnitude;
        break;

      case "stock_out":
        accumulator.stockOut += magnitude;
        break;

      case "waste": {
        accumulator.waste += magnitude;
        accumulator.wasteEvents += 1;

        const reason =
          movement.reason_code ?? "UNSPECIFIED";

        wasteReasonCounts.set(
          reason,
          (wasteReasonCounts.get(reason) ?? 0) + 1,
        );

        break;
      }

      case "po_receive":
        accumulator.poReceive += magnitude;
        break;

      case "adjustment":
        accumulator.adjustment += signed;
        accumulator.adjustmentEvents += 1;
        break;
    }
  }

  let purchaseOrderLinesUnknownItem = 0;
  let openPoLineCount = 0;

  for (const line of source.purchase_order_lines) {
    if (!isOpenPurchaseOrderStatus(line.po_status)) {
      continue;
    }

    if (!itemsById.has(line.item_id)) {
      purchaseOrderLinesUnknownItem += 1;
      continue;
    }

    const remaining = Math.max(
      0,
      toScaled(line.ordered_base_quantity) -
        toScaled(line.received_base_quantity),
    );

    if (remaining === 0) {
      continue;
    }

    const accumulator = accumulatorFor(line.item_id);

    accumulator.openPoRemaining += remaining;
    accumulator.openPoCount += 1;
    openPoLineCount += 1;
  }

  const sortedItems = [...itemsById.values()].sort(
    compareItems,
  );

  const activeItems: ItemFacts[] = [];
  const inactiveItemsWithActivity: ItemFacts[] = [];

  let stockStatusMismatchCount = 0;

  for (const row of sortedItems) {
    const facts = buildItemFacts(
      row,
      accumulators.get(row.item_id) ??
        emptyAccumulator(),
    );

    const expectedStatus = expectedStockStatus(
      toScaled(row.current_quantity),
      toScaled(row.reorder_point),
    );

    if (expectedStatus !== row.stock_status) {
      stockStatusMismatchCount += 1;
    }

    if (row.is_active) {
      activeItems.push(facts);
    } else if (
      facts.movement_event_count_7d > 0 ||
      facts.open_po_count > 0
    ) {
      inactiveItemsWithActivity.push(facts);
    }
  }

  const statusCounts = Object.fromEntries(
    PURCHASE_ORDER_STATUSES.map((status) => [
      status,
      0,
    ]),
  ) as Record<PurchaseOrderStatus, number>;

  for (const order of source.purchase_orders) {
    statusCounts[order.status] += 1;
  }

  const datasets = source.datasets;

  const inventoryRowsComplete =
    datasets.inventory.complete;

  const movementRowsComplete =
    datasets.movements.complete;

  const purchaseOrderRowsComplete =
    datasets.purchase_orders.complete &&
    datasets.purchase_order_lines.complete;

  const excludedRowCount =
    movementsUnknownItem +
    movementsUnitMismatch +
    purchaseOrderLinesUnknownItem;

  const snapshot: BusinessSnapshotV2 = {
    version: SNAPSHOT_V2_VERSION,
    generated_at: source.generated_at,
    scope: source.scope,
    window: source.window,

    availability: {
      usage_rate_available: false,
      forecast_available: false,
    },

    inventory: {
      totals: {
        active_item_count: activeItems.length,
        normal_count: activeItems.filter(
          (item) => item.stock_status === "NORMAL",
        ).length,
        low_stock_count: activeItems.filter(
          (item) => item.stock_status === "LOW_STOCK",
        ).length,
        out_of_stock_count: activeItems.filter(
          (item) =>
            item.stock_status === "OUT_OF_STOCK",
        ).length,
        below_minimum_count: activeItems.filter(
          (item) => item.below_minimum,
        ).length,
        reorder_required_count: activeItems.filter(
          (item) => item.reorder_required,
        ).length,
        reorder_covered_by_open_po_count:
          activeItems.filter(
            (item) => item.reorder_covered_by_open_po,
          ).length,
      },
      items: activeItems,
    },

    inactive_items_with_activity:
      inactiveItemsWithActivity,

    movements_7d: {
      event_count: includedMovements,
      event_counts_by_type: eventCountsByType,
      waste_reason_event_counts: Object.fromEntries(
        [...wasteReasonCounts.entries()].sort(
          ([a], [b]) => compareText(a, b),
        ),
      ),
    },

    purchasing: {
      total_po_count: source.purchase_orders.length,
      status_counts: statusCounts,
      open_po_count:
        statusCounts.ORDERED +
        statusCounts.PARTIALLY_RECEIVED,
      ordered_po_count: statusCounts.ORDERED,
      partially_received_po_count:
        statusCounts.PARTIALLY_RECEIVED,
      received_po_count: statusCounts.RECEIVED,
      open_po_line_count: openPoLineCount,
    },

    data_quality: {
      complete:
        inventoryRowsComplete &&
        movementRowsComplete &&
        purchaseOrderRowsComplete &&
        excludedRowCount === 0,
      generated_at: source.generated_at,
      inventory_rows_complete: inventoryRowsComplete,
      movement_rows_complete: movementRowsComplete,
      purchase_order_rows_complete:
        purchaseOrderRowsComplete,
      excluded_row_count: excludedRowCount,
      excluded_rows: {
        movements_unknown_item: movementsUnknownItem,
        movements_unit_mismatch: movementsUnitMismatch,
        purchase_order_lines_unknown_item:
          purchaseOrderLinesUnknownItem,
      },
      stock_status_mismatch_count:
        stockStatusMismatchCount,
      datasets: {
        inventory: datasets.inventory,
        movements: datasets.movements,
        purchase_orders: datasets.purchase_orders,
        purchase_order_lines:
          datasets.purchase_order_lines,
      },
    },
  };

  return businessSnapshotV2Schema.parse(snapshot);
}
