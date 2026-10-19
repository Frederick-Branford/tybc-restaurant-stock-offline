import {
  deriveBusinessSnapshotV2,
  type BusinessSnapshotV2,
  type StockStatus,
} from "@/lib/ai/snapshot/facts";

import {
  inventoryRow,
  movementRow,
  purchaseOrderLineRow,
  snapshotSource,
  type SourceRows,
} from "./snapshot-fixtures";

// Builds consistent Business Snapshot V2 objects for Local AI tests.
// Reorder point 7000, minimum stock 3000, base unit g.

export type ItemSpec = {
  sku: string;
  status?: StockStatus;
  belowMinimum?: boolean;
  waste?: number;
  wasteReason?: string;
  adjustment?: number;
  openPo?: number;
  name?: string;
  itemId?: string;
  active?: boolean;
};

function currentQuantityFor(spec: ItemSpec): number {
  switch (spec.status ?? "NORMAL") {
    case "OUT_OF_STOCK":
      return 0;
    case "LOW_STOCK":
      return spec.belowMinimum ? 2000 : 6500;
    case "NORMAL":
      return 11700;
  }
}

export function sourceFor(
  specs: ItemSpec[],
  extra: Pick<SourceRows, "datasets"> = {},
): SourceRows {
  const rows: Required<Omit<SourceRows, "datasets">> = {
    inventory: [],
    movements: [],
    purchase_orders: [],
    purchase_order_lines: [],
  };

  for (const spec of specs) {
    const itemId = spec.itemId ?? `item-${spec.sku}`;
    const status = spec.status ?? "NORMAL";

    rows.inventory.push(
      inventoryRow({
        item_id: itemId,
        sku: spec.sku,
        name: spec.name ?? `Name of ${spec.sku}`,
        current_quantity: currentQuantityFor(spec),
        stock_status: status,
        below_minimum:
          spec.belowMinimum ?? status === "OUT_OF_STOCK",
        is_active: spec.active ?? true,
      }),
    );

    if (spec.waste) {
      rows.movements.push(
        movementRow({
          item_id: itemId,
          movement_type: "WASTE",
          base_quantity: -spec.waste,
          reason_code: spec.wasteReason ?? "EXPIRED",
        }),
      );
    }

    if (spec.adjustment) {
      rows.movements.push(
        movementRow({
          item_id: itemId,
          movement_type: "COUNT_ADJUSTMENT",
          base_quantity: spec.adjustment,
        }),
      );
    }

    if (spec.openPo) {
      rows.purchase_order_lines.push(
        purchaseOrderLineRow({
          id: `pol-${spec.sku}`,
          purchase_order_id: `po-${spec.sku}`,
          item_id: itemId,
          ordered_base_quantity: spec.openPo,
        }),
      );
    }
  }

  return { ...rows, datasets: extra.datasets };
}

export function snapshotFor(
  specs: ItemSpec[],
  extra: Pick<SourceRows, "datasets"> = {},
): BusinessSnapshotV2 {
  return deriveBusinessSnapshotV2(
    snapshotSource(sourceFor(specs, extra)),
  );
}

export function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.freeze(value);

    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
  }

  return value;
}
