import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  buildBusinessSnapshotV2,
  INVENTORY_COLUMNS,
  MOVEMENT_COLUMNS,
  PURCHASE_ORDER_COLUMNS,
  PURCHASE_ORDER_LINE_COLUMNS,
} from "@/lib/ai/business-snapshot-v2";

import { businessSnapshotV2Schema } from "@/lib/ai/snapshot/facts";

import {
  FakePostgrest,
  type FakePostgrestOptions,
  type FakeRow,
} from "./support/fake-postgrest";

import {
  GENERATED_AT,
  inventoryRow,
  UNIT_PIECE,
  WINDOW_SINCE,
} from "./support/snapshot-fixtures";

const holder = vi.hoisted(() => ({
  client: null as unknown,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => holder.client,
}));

const NOW = new Date(GENERATED_AT);
const IN_WINDOW = "2026-10-14T03:00:00.000Z";
const CREATED_BEFORE_SNAPSHOT = "2026-10-14T03:00:01.000Z";
const AFTER_SNAPSHOT = "2026-10-15T03:00:01.000Z";

function inventoryTableRow(
  overrides: Record<string, unknown> = {},
): FakeRow {
  return {
    ...inventoryRow(),
    category_id: "cat-meat",
    ...overrides,
  };
}

function movementTableRow(
  index: number,
  overrides: Record<string, unknown> = {},
): FakeRow {
  return {
    id: `mv-${String(index).padStart(6, "0")}`,
    item_id: "item-chicken",
    movement_type: "STOCK_IN",
    input_quantity: 10,
    input_unit_id: "unit-g",
    conversion_to_base: 1,
    base_unit_id: "unit-g",
    base_quantity: 10,
    reason_code: null,
    note: "free-text note must not be read",
    reference_type: null,
    reference_id: null,
    idempotency_key: `key-${index}`,
    occurred_at: IN_WINDOW,
    created_by: "user-secret-id",
    created_at: CREATED_BEFORE_SNAPSHOT,
    ...overrides,
  };
}

function movements(count: number): FakeRow[] {
  return Array.from({ length: count }, (_, index) =>
    movementTableRow(index),
  );
}

function purchaseOrderTableRow(
  id: string,
  status: string,
): FakeRow {
  return {
    id,
    po_number: `PO-${id}`,
    supplier_id: "supplier-1",
    status,
    notes: "supplier note must not be read",
    created_by: "user-secret-id",
    created_at: IN_WINDOW,
  };
}

function purchaseOrderLineTableRow(
  id: string,
  status: string,
  overrides: Record<string, unknown> = {},
): FakeRow {
  return {
    id,
    purchase_order_id: `po-${id}`,
    item_id: "item-chicken",
    ordered_quantity: 5,
    order_unit_id: "unit-kg",
    conversion_to_base: 1000,
    ordered_base_quantity: 5000,
    unit_cost: 150,
    received_quantity: 0,
    received_base_quantity: 0,
    purchase_orders: { status },
    ...overrides,
  };
}

function useTables(
  tables: Partial<Record<string, FakeRow[]>>,
  options: FakePostgrestOptions = {},
): FakePostgrest {
  const client = new FakePostgrest(
    {
      inventory_balances: [],
      stock_movements: [],
      purchase_orders: [],
      purchase_order_items: [],
      ...tables,
    } as Record<string, FakeRow[]>,
    options,
  );

  holder.client = client;

  return client;
}

describe("buildBusinessSnapshotV2 (server-only I/O layer)", () => {
  beforeEach(() => {
    holder.client = null;
  });

  it("builds a complete, schema-valid snapshot from database rows", async () => {
    const client = useTables({
      inventory_balances: [inventoryTableRow()],
      stock_movements: [
        movementTableRow(1, {
          movement_type: "WASTE",
          base_quantity: -1100,
          reason_code: "EXPIRED",
        }),
        movementTableRow(2, {
          movement_type: "COUNT_ADJUSTMENT",
          base_quantity: -200,
        }),
      ],
      purchase_orders: [
        purchaseOrderTableRow("po-1", "ORDERED"),
      ],
      purchase_order_items: [
        purchaseOrderLineTableRow("1", "ORDERED"),
      ],
    });

    const snapshot = await buildBusinessSnapshotV2({
      now: NOW,
    });

    expect(
      businessSnapshotV2Schema.safeParse(snapshot).success,
    ).toBe(true);
    expect(snapshot.generated_at).toBe(GENERATED_AT);
    expect(snapshot.window).toEqual({
      days: 7,
      since: WINDOW_SINCE,
      until: GENERATED_AT,
    });
    expect(snapshot.inventory.items[0]).toMatchObject({
      sku: "CHICKEN-BREAST",
      waste_7d: 1100,
      adjustment_7d: -200,
      open_po_remaining_quantity: 5000,
    });
    expect(snapshot.data_quality.complete).toBe(true);
    expect(client.writeAttempts).toEqual([]);
  });

  it.each([
    [1000, 1],
    [1001, 2],
    [2500, 3],
  ])(
    "reads %d stock movements in %d page(s) without truncation",
    async (count, pages) => {
      const client = useTables({
        inventory_balances: [inventoryTableRow()],
        stock_movements: movements(count),
      });

      const snapshot = await buildBusinessSnapshotV2({
        now: NOW,
      });

      expect(client.queriesFor("stock_movements")).toHaveLength(
        pages,
      );
      expect(snapshot.inventory.items[0].stock_in_7d).toBe(
        count * 10,
      );
      expect(
        snapshot.inventory.items[0].movement_event_count_7d,
      ).toBe(count);
      expect(snapshot.data_quality.datasets.movements).toEqual({
        expected_rows: count,
        rows_read: count,
        complete: true,
        incomplete_reason: null,
      });
      expect(snapshot.data_quality.complete).toBe(true);
    },
  );

  it("paginates inventory beyond 1000 items", async () => {
    const items = Array.from({ length: 1001 }, (_, index) =>
      inventoryTableRow({
        item_id: `item-${String(index).padStart(5, "0")}`,
        sku: `SKU-${String(index).padStart(5, "0")}`,
        name: `Item ${index}`,
      }),
    );

    const client = useTables({ inventory_balances: items });

    const snapshot = await buildBusinessSnapshotV2({
      now: NOW,
    });

    expect(client.queriesFor("inventory_balances")).toHaveLength(
      2,
    );
    expect(snapshot.inventory.items).toHaveLength(1001);
    expect(snapshot.data_quality.inventory_rows_complete).toBe(
      true,
    );
  });

  it("uses read-only, column-limited, stably ordered queries with exact counts", async () => {
    const client = useTables({
      inventory_balances: [inventoryTableRow()],
      stock_movements: movements(1),
      purchase_orders: [
        purchaseOrderTableRow("po-1", "ORDERED"),
      ],
      purchase_order_items: [
        purchaseOrderLineTableRow("1", "ORDERED"),
      ],
    });

    const snapshot = await buildBusinessSnapshotV2({
      now: NOW,
    });

    const [inventoryQuery] = client.queriesFor(
      "inventory_balances",
    );
    const [movementQuery] =
      client.queriesFor("stock_movements");
    const [orderQuery] = client.queriesFor("purchase_orders");
    const [lineQuery] = client.queriesFor(
      "purchase_order_items",
    );

    expect(inventoryQuery).toMatchObject({
      columns: INVENTORY_COLUMNS,
      count: "exact",
      filters: [],
      orders: [{ column: "item_id", ascending: true }],
      range: { from: 0, to: 999 },
    });

    expect(movementQuery).toMatchObject({
      columns: MOVEMENT_COLUMNS,
      count: "exact",
      filters: [
        { op: "gte", column: "occurred_at", value: WINDOW_SINCE },
        { op: "lte", column: "occurred_at", value: GENERATED_AT },
        { op: "lte", column: "created_at", value: GENERATED_AT },
      ],
      orders: [
        { column: "occurred_at", ascending: true },
        { column: "id", ascending: true },
      ],
      range: { from: 0, to: 999 },
    });

    expect(orderQuery).toMatchObject({
      columns: PURCHASE_ORDER_COLUMNS,
      count: "exact",
      orders: [{ column: "id", ascending: true }],
    });

    expect(lineQuery).toMatchObject({
      columns: PURCHASE_ORDER_LINE_COLUMNS,
      count: "exact",
      filters: [
        {
          op: "in",
          column: "purchase_orders.status",
          value: ["ORDERED", "PARTIALLY_RECEIVED"],
        },
      ],
      orders: [{ column: "id", ascending: true }],
    });

    const selected = client.queries
      .map((query) => query.columns ?? "")
      .join(",");

    for (const forbidden of [
      "note",
      "notes",
      "created_by",
      "idempotency_key",
      "unit_cost",
      "*",
    ]) {
      expect(
        selected.split(/[\s,()]+/),
      ).not.toContain(forbidden);
    }

    expect(JSON.stringify(snapshot)).not.toMatch(
      /must not be read|user-secret-id/,
    );

    expect(
      [...new Set(client.queries.map((query) => query.table))].sort(),
    ).toEqual([
      "inventory_balances",
      "purchase_order_items",
      "purchase_orders",
      "stock_movements",
    ]);
    expect(client.writeAttempts).toEqual([]);
  });

  it("limits movements to the 7-day window ending at the snapshot time", async () => {
    useTables({
      inventory_balances: [inventoryTableRow()],
      stock_movements: [
        movementTableRow(1, {
          occurred_at: "2026-10-08T02:59:59.999Z",
          base_quantity: 1,
        }),
        movementTableRow(2, {
          occurred_at: WINDOW_SINCE,
          base_quantity: 10,
        }),
        movementTableRow(3, {
          occurred_at: GENERATED_AT,
          base_quantity: 100,
        }),
        movementTableRow(4, {
          occurred_at: AFTER_SNAPSHOT,
          base_quantity: 1000,
        }),
      ],
    });

    const snapshot = await buildBusinessSnapshotV2({
      now: NOW,
    });

    expect(snapshot.inventory.items[0].stock_in_7d).toBe(110);
  });

  it("ignores movements inserted after the snapshot time while paging", async () => {
    const client = useTables(
      {
        inventory_balances: [inventoryTableRow()],
        stock_movements: movements(1500),
      },
      {
        beforeExecute: (query, tables) => {
          if (
            query.table === "stock_movements" &&
            query.range?.from === 1000
          ) {
            tables.stock_movements.push(
              movementTableRow(999_999, {
                created_at: AFTER_SNAPSHOT,
              }),
            );
          }
        },
      },
    );

    const snapshot = await buildBusinessSnapshotV2({
      now: NOW,
    });

    expect(client.queriesFor("stock_movements")).toHaveLength(
      2,
    );
    expect(
      snapshot.inventory.items[0].movement_event_count_7d,
    ).toBe(1500);
    expect(snapshot.data_quality.complete).toBe(true);
  });

  it("reports purchase orders incomplete when rows change between pages", async () => {
    const orders = Array.from({ length: 1001 }, (_, index) =>
      purchaseOrderTableRow(
        `po-${String(index).padStart(5, "0")}`,
        "RECEIVED",
      ),
    );

    useTables(
      {
        inventory_balances: [inventoryTableRow()],
        purchase_orders: orders,
      },
      {
        beforeExecute: (query, tables) => {
          if (
            query.table === "purchase_orders" &&
            query.range?.from === 1000
          ) {
            tables.purchase_orders.push(
              purchaseOrderTableRow("po-99999", "DRAFT"),
            );
          }
        },
      },
    );

    const snapshot = await buildBusinessSnapshotV2({
      now: NOW,
    });

    expect(snapshot.data_quality).toMatchObject({
      complete: false,
      purchase_order_rows_complete: false,
      movement_rows_complete: true,
      inventory_rows_complete: true,
    });
    expect(
      snapshot.data_quality.datasets.purchase_orders
        .incomplete_reason,
    ).toBe("COUNT_CHANGED");
  });

  it("keeps the identity of an inactive item with historical movements", async () => {
    useTables({
      inventory_balances: [
        inventoryTableRow(),
        inventoryTableRow({
          item_id: "item-old-sauce",
          sku: "OLD-SAUCE",
          name: "ซอสสูตรเก่า",
          ...UNIT_PIECE,
          current_quantity: 3,
          minimum_stock: 0,
          reorder_point: 0,
          is_active: false,
        }),
      ],
      stock_movements: [
        movementTableRow(1, {
          item_id: "item-old-sauce",
          movement_type: "WASTE",
          base_quantity: -2,
          base_unit_id: UNIT_PIECE.base_unit_id,
          reason_code: "EXPIRED",
        }),
      ],
    });

    const snapshot = await buildBusinessSnapshotV2({
      now: NOW,
    });

    expect(snapshot.inactive_items_with_activity).toEqual([
      expect.objectContaining({
        sku: "OLD-SAUCE",
        name: "ซอสสูตรเก่า",
        is_active: false,
        waste_7d: 2,
      }),
    ]);
    expect(snapshot.data_quality.complete).toBe(true);
  });

  it("fails instead of returning partial facts when a query errors", async () => {
    useTables(
      {
        inventory_balances: [inventoryTableRow()],
      },
      {
        failTable: {
          table: "stock_movements",
          message: "statement timeout",
        },
      },
    );

    await expect(
      buildBusinessSnapshotV2({ now: NOW }),
    ).rejects.toThrow("stock_movements: statement timeout");
  });
});
