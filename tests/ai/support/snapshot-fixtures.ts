import type {
  DatasetRead,
  InventoryBalanceRow,
  PurchaseOrderLineRow,
  PurchaseOrderRow,
  SnapshotSource,
  StockMovementRow,
} from "@/lib/ai/snapshot/facts";

// Deterministic fixtures for Snapshot V2 tests. No randomness, no clock.

export const GENERATED_AT = "2026-10-15T03:00:00.000Z";
export const WINDOW_SINCE = "2026-10-08T03:00:00.000Z";
export const IN_WINDOW = "2026-10-14T03:00:00.000Z";

export const UNIT_GRAM = {
  base_unit_id: "unit-g",
  base_unit_code: "GRAM",
  base_unit_symbol: "g",
} as const;

export const UNIT_PIECE = {
  base_unit_id: "unit-pcs",
  base_unit_code: "PIECE",
  base_unit_symbol: "pcs",
} as const;

export function inventoryRow(
  overrides: Partial<InventoryBalanceRow> = {},
): InventoryBalanceRow {
  return {
    item_id: "item-chicken",
    sku: "CHICKEN-BREAST",
    name: "อกไก่",
    ...UNIT_GRAM,
    current_quantity: 11700,
    minimum_stock: 3000,
    reorder_point: 7000,
    stock_status: "NORMAL",
    below_minimum: false,
    is_active: true,
    ...overrides,
  };
}

let movementSequence = 0;

export function movementRow(
  overrides: Partial<StockMovementRow> = {},
): StockMovementRow {
  movementSequence += 1;

  return {
    id: `mv-${String(movementSequence).padStart(6, "0")}`,
    item_id: "item-chicken",
    movement_type: "STOCK_IN",
    base_quantity: 1000,
    base_unit_id: UNIT_GRAM.base_unit_id,
    reason_code: null,
    occurred_at: IN_WINDOW,
    ...overrides,
  };
}

export function purchaseOrderRow(
  overrides: Partial<PurchaseOrderRow> = {},
): PurchaseOrderRow {
  return {
    id: "po-1",
    status: "ORDERED",
    ...overrides,
  };
}

export function purchaseOrderLineRow(
  overrides: Partial<PurchaseOrderLineRow> = {},
): PurchaseOrderLineRow {
  return {
    id: "pol-1",
    purchase_order_id: "po-1",
    item_id: "item-chicken",
    ordered_base_quantity: 5000,
    received_base_quantity: 0,
    po_status: "ORDERED",
    ...overrides,
  };
}

export function completeDataset(rows: number): DatasetRead {
  return {
    expected_rows: rows,
    rows_read: rows,
    complete: true,
    incomplete_reason: null,
  };
}

export type SourceRows = {
  inventory?: InventoryBalanceRow[];
  movements?: StockMovementRow[];
  purchase_orders?: PurchaseOrderRow[];
  purchase_order_lines?: PurchaseOrderLineRow[];
  datasets?: Partial<SnapshotSource["datasets"]>;
};

export function snapshotSource(
  rows: SourceRows = {},
): SnapshotSource {
  const inventory = rows.inventory ?? [];
  const movements = rows.movements ?? [];
  const purchaseOrders = rows.purchase_orders ?? [];
  const purchaseOrderLines =
    rows.purchase_order_lines ?? [];

  return {
    generated_at: GENERATED_AT,
    scope: { type: "GLOBAL" },
    window: {
      days: 7,
      since: WINDOW_SINCE,
      until: GENERATED_AT,
    },
    inventory,
    movements,
    purchase_orders: purchaseOrders,
    purchase_order_lines: purchaseOrderLines,
    datasets: {
      inventory: completeDataset(inventory.length),
      movements: completeDataset(movements.length),
      purchase_orders: completeDataset(
        purchaseOrders.length,
      ),
      purchase_order_lines: completeDataset(
        purchaseOrderLines.length,
      ),
      ...rows.datasets,
    },
  };
}
