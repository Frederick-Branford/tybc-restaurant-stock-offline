import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

type InventoryRow = {
  item_id: string;
  sku: string;
  name: string;
  base_unit_symbol: string;
  current_quantity: number | string;
  minimum_stock: number | string;
  reorder_point: number | string;
  stock_status: string;
};

type MovementRow = {
  item_id: string;
  movement_type: string;
  base_quantity: number | string;
  reason_code: string | null;
  occurred_at: string;
};

type PurchaseOrderRow = {
  id: string;
  po_number: string;
  status: string;
  created_at: string;
};

function toNumber(
  value: number | string | null | undefined,
) {
  return Number(value ?? 0);
}

export async function buildBusinessSnapshot() {
  const admin = createAdminClient();

  const now = new Date();

  const sevenDaysAgo = new Date(
    now.getTime() -
      7 * 24 * 60 * 60 * 1000,
  ).toISOString();

  const [
    inventoryResult,
    movementsResult,
    purchaseOrdersResult,
  ] = await Promise.all([
    admin
      .from("inventory_balances")
      .select(
        "item_id, sku, name, base_unit_symbol, current_quantity, minimum_stock, reorder_point, stock_status",
      )
      .eq("is_active", true)
      .order("name"),

    admin
      .from("stock_movements")
      .select(
        "item_id, movement_type, base_quantity, reason_code, occurred_at",
      )
      .gte(
        "occurred_at",
        sevenDaysAgo,
      )
      .order(
        "occurred_at",
        {
          ascending: false,
        },
      ),

    admin
      .from("purchase_orders")
      .select(
        "id, po_number, status, created_at",
      )
      .order(
        "created_at",
        {
          ascending: false,
        },
      ),
  ]);

  const errors = [
    inventoryResult.error,
    movementsResult.error,
    purchaseOrdersResult.error,
  ].filter(Boolean);

  if (errors.length > 0) {
    throw new Error(
      errors
        .map(
          (error) =>
            error?.message,
        )
        .filter(Boolean)
        .join(" | "),
    );
  }

  const inventory =
    (inventoryResult.data ??
      []) as InventoryRow[];

  const movements =
    (movementsResult.data ??
      []) as MovementRow[];

  const purchaseOrders =
    (purchaseOrdersResult.data ??
      []) as PurchaseOrderRow[];

  const inventoryMap =
    new Map(
      inventory.map(
        (item) => [
          item.item_id,
          item,
        ],
      ),
    );

  const movementByItem =
    new Map<
      string,
      {
        stock_in: number;
        stock_out: number;
        waste: number;
        po_receive: number;
        adjustment: number;
        event_count: number;
      }
    >();

  const wasteReasons =
    new Map<
      string,
      number
    >();

  for (const movement of movements) {
    const summary =
      movementByItem.get(
        movement.item_id,
      ) ?? {
        stock_in: 0,
        stock_out: 0,
        waste: 0,
        po_receive: 0,
        adjustment: 0,
        event_count: 0,
      };

    const signedQuantity =
      toNumber(
        movement.base_quantity,
      );

    const quantity =
      Math.abs(
        signedQuantity,
      );

    summary.event_count += 1;

    switch (
      movement.movement_type
    ) {
      case "OPENING_BALANCE":
      case "STOCK_IN":
      case "RETURN_IN":
        summary.stock_in +=
          quantity;
        break;

      case "STOCK_OUT":
      case "POS_DEDUCTION":
      case "RETURN_OUT":
        summary.stock_out +=
          quantity;
        break;

      case "WASTE": {
        summary.waste +=
          quantity;

        const reason =
          movement.reason_code ??
          "OTHER";

        wasteReasons.set(
          reason,
          (wasteReasons.get(
            reason,
          ) ?? 0) + 1,
        );

        break;
      }

      case "PO_RECEIVE":
        summary.po_receive +=
          quantity;
        break;

      case "COUNT_ADJUSTMENT":
      case "MANUAL_ADJUSTMENT":
        summary.adjustment +=
          signedQuantity;
        break;
    }

    movementByItem.set(
      movement.item_id,
      summary,
    );
  }

  const stock =
    inventory.map(
      (item) => ({
        sku: item.sku,
        name: item.name,

        current_quantity:
          toNumber(
            item.current_quantity,
          ),

        unit:
          item.base_unit_symbol,

        minimum_stock:
          toNumber(
            item.minimum_stock,
          ),

        reorder_point:
          toNumber(
            item.reorder_point,
          ),

        difference_from_reorder:
          toNumber(
            item.current_quantity,
          ) -
          toNumber(
            item.reorder_point,
          ),

        status:
          item.stock_status,
      }),
    );

  const movementSummary =
    [...movementByItem.entries()]
      .map(
        ([itemId, summary]) => {
          const item =
            inventoryMap.get(
              itemId,
            );

          return {
            sku:
              item?.sku ??
              itemId,

            name:
              item?.name ??
              "Unknown item",

            unit:
              item
                ?.base_unit_symbol ??
              null,

            ...summary,
          };
        },
      );

  const purchasingStatus =
    purchaseOrders.reduce<
      Record<string, number>
    >(
      (result, order) => {
        result[order.status] =
          (result[
            order.status
          ] ?? 0) + 1;

        return result;
      },
      {},
    );

  return {
    generated_at:
      now.toISOString(),

    analysis_period: {
      movement_days: 7,

      movement_since:
        sevenDaysAgo,
    },

    inventory: {
      total_items:
        stock.length,

      low_stock_count:
        stock.filter(
          (item) =>
            item.status ===
              "LOW_STOCK" ||
            item.status ===
              "OUT_OF_STOCK",
        ).length,

      items:
        stock,
    },

    movement_7d:
      movementSummary,

    waste_7d: {
      total_events:
        movements.filter(
          (movement) =>
            movement.movement_type ===
            "WASTE",
        ).length,

      reason_event_counts:
        Object.fromEntries(
          wasteReasons,
        ),
    },

    purchasing: {
      total_purchase_orders:
        purchaseOrders.length,

      status_counts:
        purchasingStatus,
    },

    limitations: [
      "สินค้าแต่ละรายการอาจใช้หน่วยต่างกัน เช่น g, ml, pcs ห้ามนำมาบวกรวมเป็นปริมาณเดียว",
      "current_quantity, reorder_point และ stock_status จากฐานข้อมูลเป็น Source of Truth",
      "ระบบยังไม่มี Recipe หรือ BOM",
      "ระบบยังไม่มีข้อมูลยอดขายและอัตราการใช้ต่อวันสำหรับการ Forecast",
      "ระบบยังไม่มี Inventory Costing Method สำหรับประเมินมูลค่า Stock",
    ],
  };
}