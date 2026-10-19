import "server-only";

import { z } from "zod";

import {
  deriveBusinessSnapshotV2,
  inventoryBalanceRowSchema,
  MOVEMENT_WINDOW_DAYS,
  OPEN_PURCHASE_ORDER_STATUSES,
  PURCHASE_ORDER_STATUSES,
  purchaseOrderLineRowSchema,
  purchaseOrderRowSchema,
  stockMovementRowSchema,
  type BusinessSnapshotV2,
  type DatasetRead,
} from "@/lib/ai/snapshot/facts";

import {
  readAllPages,
  type PageResult,
  type PaginatedRead,
} from "@/lib/ai/snapshot/paginate";

import { createAdminClient } from "@/lib/supabase/admin";

// Business Snapshot V2: server-only, read-only I/O layer.
//
// Reads only the columns the fact layer needs (no notes, no user data),
// paginates every dataset that can exceed PostgREST max_rows, and reports
// completeness. All derivation happens in src/lib/ai/snapshot/facts.ts.
//
// Scope: V1.1 is a single restaurant with global inventory. Branch scoping
// would add filters here and a new scope type; the fact layer is unchanged.

export const INVENTORY_COLUMNS =
  "item_id, sku, name, base_unit_id, base_unit_code, base_unit_symbol, current_quantity, minimum_stock, reorder_point, stock_status, below_minimum, is_active";

export const MOVEMENT_COLUMNS =
  "id, item_id, movement_type, base_quantity, base_unit_id, reason_code, occurred_at";

export const PURCHASE_ORDER_COLUMNS = "id, status";

export const PURCHASE_ORDER_LINE_COLUMNS =
  "id, purchase_order_id, item_id, ordered_base_quantity, received_base_quantity, purchase_orders!inner(status)";

const DAY_MS = 24 * 60 * 60 * 1000;

const purchaseOrderLineApiRowSchema = z.object({
  id: z.string(),
  purchase_order_id: z.string(),
  item_id: z.string(),
  ordered_base_quantity:
    purchaseOrderLineRowSchema.shape.ordered_base_quantity,
  received_base_quantity:
    purchaseOrderLineRowSchema.shape.received_base_quantity,
  purchase_orders: z.object({
    status: z.enum(PURCHASE_ORDER_STATUSES),
  }),
});

type QueryResponse = {
  data: unknown;
  error: { message: string; code?: string } | null;
  count: number | null;
};

function toPage<Row>(
  response: QueryResponse,
  parseRows: (data: unknown) => Row[],
): PageResult<Row> {
  if (response.error) {
    return {
      data: null,
      error: {
        message: response.error.message,
        code: response.error.code,
      },
      count: response.count,
    };
  }

  return {
    data:
      response.data === null
        ? null
        : parseRows(response.data),
    error: null,
    count: response.count,
  };
}

function toDatasetRead<Row>(
  read: PaginatedRead<Row>,
): DatasetRead {
  return {
    expected_rows: read.expected_rows,
    rows_read: read.rows_read,
    complete: read.complete,
    incomplete_reason: read.incomplete_reason,
  };
}

export type BuildBusinessSnapshotV2Options = {
  now?: Date;
};

export async function buildBusinessSnapshotV2(
  options: BuildBusinessSnapshotV2Options = {},
): Promise<BusinessSnapshotV2> {
  const admin = createAdminClient();

  const now = options.now ?? new Date();

  const until = now.toISOString();

  const since = new Date(
    now.getTime() - MOVEMENT_WINDOW_DAYS * DAY_MS,
  ).toISOString();

  const [
    inventory,
    movements,
    purchaseOrders,
    purchaseOrderLines,
  ] = await Promise.all([
    // All items, active and inactive: inactive items keep their identity
    // for historical movements and open purchase order lines.
    readAllPages(
      async ({ from, to }) =>
        toPage(
          await admin
            .from("inventory_balances")
            .select(INVENTORY_COLUMNS, {
              count: "exact",
            })
            .order("item_id", { ascending: true })
            .range(from, to),
          (data) =>
            z.array(inventoryBalanceRowSchema).parse(data),
        ),
      {
        label: "inventory_balances",
        getRowId: (row) => row.item_id,
      },
    ),

    // Movements are immutable. Bounding by created_at <= until freezes the
    // set while pages are read; rows inserted later are excluded.
    readAllPages(
      async ({ from, to }) =>
        toPage(
          await admin
            .from("stock_movements")
            .select(MOVEMENT_COLUMNS, {
              count: "exact",
            })
            .gte("occurred_at", since)
            .lte("occurred_at", until)
            .lte("created_at", until)
            .order("occurred_at", { ascending: true })
            .order("id", { ascending: true })
            .range(from, to),
          (data) =>
            z.array(stockMovementRowSchema).parse(data),
        ),
      {
        label: "stock_movements",
        getRowId: (row) => row.id,
      },
    ),

    readAllPages(
      async ({ from, to }) =>
        toPage(
          await admin
            .from("purchase_orders")
            .select(PURCHASE_ORDER_COLUMNS, {
              count: "exact",
            })
            .order("id", { ascending: true })
            .range(from, to),
          (data) =>
            z.array(purchaseOrderRowSchema).parse(data),
        ),
      {
        label: "purchase_orders",
        getRowId: (row) => row.id,
      },
    ),

    // Only lines of open purchase orders affect on-order quantities.
    readAllPages(
      async ({ from, to }) =>
        toPage(
          await admin
            .from("purchase_order_items")
            .select(PURCHASE_ORDER_LINE_COLUMNS, {
              count: "exact",
            })
            .in("purchase_orders.status", [
              ...OPEN_PURCHASE_ORDER_STATUSES,
            ])
            .order("id", { ascending: true })
            .range(from, to),
          (data) =>
            z
              .array(purchaseOrderLineApiRowSchema)
              .parse(data)
              .map((row) => ({
                id: row.id,
                purchase_order_id: row.purchase_order_id,
                item_id: row.item_id,
                ordered_base_quantity:
                  row.ordered_base_quantity,
                received_base_quantity:
                  row.received_base_quantity,
                po_status: row.purchase_orders.status,
              })),
        ),
      {
        label: "purchase_order_items",
        getRowId: (row) => row.id,
      },
    ),
  ]);

  return deriveBusinessSnapshotV2({
    generated_at: until,
    scope: { type: "GLOBAL" },
    window: {
      days: MOVEMENT_WINDOW_DAYS,
      since,
      until,
    },
    inventory: inventory.rows,
    movements: movements.rows,
    purchase_orders: purchaseOrders.rows,
    purchase_order_lines: purchaseOrderLines.rows,
    datasets: {
      inventory: toDatasetRead(inventory),
      movements: toDatasetRead(movements),
      purchase_orders: toDatasetRead(purchaseOrders),
      purchase_order_lines: toDatasetRead(
        purchaseOrderLines,
      ),
    },
  });
}
