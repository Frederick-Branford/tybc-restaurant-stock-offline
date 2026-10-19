import { describe, expect, it } from "vitest";

import {
  businessSnapshotV2Schema,
  deriveBusinessSnapshotV2,
  type BusinessSnapshotV2,
  type ItemFacts,
  type MovementType,
} from "@/lib/ai/snapshot/facts";

import {
  GENERATED_AT,
  inventoryRow,
  movementRow,
  purchaseOrderLineRow,
  purchaseOrderRow,
  snapshotSource,
  UNIT_PIECE,
  type SourceRows,
} from "./support/snapshot-fixtures";

function derive(rows: SourceRows): BusinessSnapshotV2 {
  return deriveBusinessSnapshotV2(snapshotSource(rows));
}

function onlyItem(snapshot: BusinessSnapshotV2): ItemFacts {
  expect(snapshot.inventory.items).toHaveLength(1);

  return snapshot.inventory.items[0];
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.freeze(value);

    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
  }

  return value;
}

describe("Snapshot V2 facts: design-principle example", () => {
  it("produces the facts the local model should receive for CHICKEN-BREAST", () => {
    const item = onlyItem(
      derive({
        inventory: [inventoryRow()],
        movements: [
          movementRow({
            movement_type: "WASTE",
            base_quantity: -1100,
            reason_code: "EXPIRED",
          }),
          movementRow({
            movement_type: "COUNT_ADJUSTMENT",
            base_quantity: -200,
          }),
        ],
      }),
    );

    expect(item).toMatchObject({
      sku: "CHICKEN-BREAST",
      current_quantity: 11700,
      reorder_point: 7000,
      quantity_above_reorder: 4700,
      quantity_below_reorder: 0,
      stock_status: "NORMAL",
      reorder_required: false,
      waste_7d: 1100,
      adjustment_7d: -200,
      usage_rate_available: false,
      forecast_available: false,
    });
  });
});

describe("Snapshot V2 facts: stock status and reorder", () => {
  it("1. NORMAL item: no reorder, quantity above reorder", () => {
    const item = onlyItem(
      derive({ inventory: [inventoryRow()] }),
    );

    expect(item.stock_status).toBe("NORMAL");
    expect(item.reorder_required).toBe(false);
    expect(item.quantity_above_reorder).toBe(4700);
    expect(item.quantity_below_reorder).toBe(0);
  });

  it("2. LOW_STOCK item: reorder required, quantity below reorder", () => {
    const item = onlyItem(
      derive({
        inventory: [
          inventoryRow({
            current_quantity: 6500,
            stock_status: "LOW_STOCK",
          }),
        ],
      }),
    );

    expect(item.stock_status).toBe("LOW_STOCK");
    expect(item.reorder_required).toBe(true);
    expect(item.quantity_above_reorder).toBe(0);
    expect(item.quantity_below_reorder).toBe(500);
  });

  it("3. OUT_OF_STOCK item: reorder required, full reorder point below", () => {
    const item = onlyItem(
      derive({
        inventory: [
          inventoryRow({
            current_quantity: 0,
            stock_status: "OUT_OF_STOCK",
            below_minimum: true,
          }),
        ],
      }),
    );

    expect(item.stock_status).toBe("OUT_OF_STOCK");
    expect(item.below_minimum).toBe(true);
    expect(item.reorder_required).toBe(true);
    expect(item.quantity_below_reorder).toBe(7000);
  });

  it("4. current == reorder_point: reorder required, both differences 0, DB status preserved", () => {
    const item = onlyItem(
      derive({
        inventory: [
          inventoryRow({
            current_quantity: 7000,
            stock_status: "LOW_STOCK",
          }),
        ],
      }),
    );

    expect(item.reorder_required).toBe(true);
    expect(item.quantity_above_reorder).toBe(0);
    expect(item.quantity_below_reorder).toBe(0);
    expect(item.stock_status).toBe("LOW_STOCK");
  });

  it("5. current > reorder: quantity_above_reorder = current - reorder", () => {
    const item = onlyItem(
      derive({
        inventory: [
          inventoryRow({ current_quantity: 7000.5 }),
        ],
      }),
    );

    expect(item.reorder_required).toBe(false);
    expect(item.quantity_above_reorder).toBe(0.5);
    expect(item.quantity_below_reorder).toBe(0);
  });

  it("6. current < reorder: quantity_below_reorder = reorder - current", () => {
    const item = onlyItem(
      derive({
        inventory: [
          inventoryRow({
            current_quantity: 1234.5678,
            stock_status: "LOW_STOCK",
          }),
        ],
      }),
    );

    expect(item.quantity_above_reorder).toBe(0);
    expect(item.quantity_below_reorder).toBe(5765.4322);
  });

  it("uses exact decimal arithmetic (no floating-point drift)", () => {
    const item = onlyItem(
      derive({
        inventory: [
          inventoryRow({
            current_quantity: "10.3",
            minimum_stock: "0",
            reorder_point: "10.1",
          }),
        ],
        movements: [
          movementRow({ base_quantity: 0.1 }),
          movementRow({ base_quantity: 0.2 }),
        ],
      }),
    );

    expect(item.quantity_above_reorder).toBe(0.2);
    expect(item.stock_in_7d).toBe(0.3);
  });

  it("sums values that are inexact in binary floating point", () => {
    const item = onlyItem(
      derive({
        inventory: [inventoryRow()],
        movements: [
          // 1.005 * 10000 and 1.4385 * 10000 are not integers in binary
          // floating point; they must still be read as exact decimals.
          movementRow({ base_quantity: 1.005 }),
          movementRow({ base_quantity: "0.57" }),
          movementRow({ base_quantity: 1.4385 }),
          movementRow({
            movement_type: "WASTE",
            base_quantity: -0.57,
          }),
        ],
      }),
    );

    expect(item.stock_in_7d).toBe(3.0135);
    expect(item.waste_7d).toBe(0.57);
  });

  it("passes the DB stock_status through and counts mismatches with the reorder rule", () => {
    const snapshot = derive({
      inventory: [
        // Inconsistent with the view rule: 6500 <= 7000 should be LOW_STOCK.
        inventoryRow({
          current_quantity: 6500,
          stock_status: "NORMAL",
        }),
      ],
    });

    const item = onlyItem(snapshot);

    expect(item.stock_status).toBe("NORMAL");
    expect(item.reorder_required).toBe(true);
    expect(
      snapshot.data_quality.stock_status_mismatch_count,
    ).toBe(1);
  });

  it("counts active inventory totals by DB status and derived flags", () => {
    const snapshot = derive({
      inventory: [
        inventoryRow({ item_id: "a", sku: "A" }),
        inventoryRow({
          item_id: "b",
          sku: "B",
          current_quantity: 6500,
          stock_status: "LOW_STOCK",
        }),
        inventoryRow({
          item_id: "c",
          sku: "C",
          current_quantity: 0,
          stock_status: "OUT_OF_STOCK",
          below_minimum: true,
        }),
      ],
    });

    expect(snapshot.inventory.totals).toEqual({
      active_item_count: 3,
      normal_count: 1,
      low_stock_count: 1,
      out_of_stock_count: 1,
      below_minimum_count: 1,
      reorder_required_count: 2,
      reorder_covered_by_open_po_count: 0,
    });
  });
});

describe("Snapshot V2 facts: movements", () => {
  it("7. waste magnitude is positive", () => {
    const item = onlyItem(
      derive({
        inventory: [inventoryRow()],
        movements: [
          movementRow({
            movement_type: "WASTE",
            base_quantity: -1100,
            reason_code: "SPOILED",
          }),
        ],
      }),
    );

    expect(item.waste_7d).toBe(1100);
    expect(item.waste_event_count_7d).toBe(1);
  });

  it("8. adjustments stay signed and net across events", () => {
    const single = onlyItem(
      derive({
        inventory: [inventoryRow()],
        movements: [
          movementRow({
            movement_type: "COUNT_ADJUSTMENT",
            base_quantity: -200,
          }),
        ],
      }),
    );

    expect(single.adjustment_7d).toBe(-200);

    const net = onlyItem(
      derive({
        inventory: [inventoryRow()],
        movements: [
          movementRow({
            movement_type: "COUNT_ADJUSTMENT",
            base_quantity: -200,
          }),
          movementRow({
            movement_type: "MANUAL_ADJUSTMENT",
            base_quantity: 50,
          }),
        ],
      }),
    );

    expect(net.adjustment_7d).toBe(-150);
    expect(net.adjustment_event_count_7d).toBe(2);
  });

  it("9. sums multiple events for the same SKU", () => {
    const snapshot = derive({
      inventory: [inventoryRow()],
      movements: [
        movementRow({ base_quantity: 1000 }),
        movementRow({ base_quantity: 2500 }),
        movementRow({
          movement_type: "STOCK_OUT",
          base_quantity: -300,
        }),
        movementRow({
          movement_type: "STOCK_OUT",
          base_quantity: -700,
        }),
        movementRow({
          movement_type: "PO_RECEIVE",
          base_quantity: 4000,
        }),
        movementRow({
          movement_type: "WASTE",
          base_quantity: -100,
          reason_code: "EXPIRED",
        }),
        movementRow({
          movement_type: "WASTE",
          base_quantity: -50,
          reason_code: "EXPIRED",
        }),
      ],
    });

    const item = onlyItem(snapshot);

    expect(item).toMatchObject({
      stock_in_7d: 3500,
      stock_out_7d: 1000,
      po_receive_7d: 4000,
      waste_7d: 150,
      waste_event_count_7d: 2,
      adjustment_7d: 0,
      movement_event_count_7d: 7,
    });

    expect(snapshot.movements_7d.event_count).toBe(7);
    expect(
      snapshot.movements_7d.waste_reason_event_counts,
    ).toEqual({ EXPIRED: 2 });
  });

  it.each<[MovementType, number, keyof ItemFacts, number]>([
    ["OPENING_BALANCE", 10, "stock_in_7d", 10],
    ["STOCK_IN", 10, "stock_in_7d", 10],
    ["RETURN_IN", 10, "stock_in_7d", 10],
    ["STOCK_OUT", -10, "stock_out_7d", 10],
    ["POS_DEDUCTION", -10, "stock_out_7d", 10],
    ["RETURN_OUT", -10, "stock_out_7d", 10],
    ["WASTE", -10, "waste_7d", 10],
    ["PO_RECEIVE", 10, "po_receive_7d", 10],
    ["COUNT_ADJUSTMENT", -10, "adjustment_7d", -10],
    ["MANUAL_ADJUSTMENT", 10, "adjustment_7d", 10],
  ])(
    "classifies %s (%d) into %s",
    (movementType, quantity, field, expected) => {
      const snapshot = derive({
        inventory: [inventoryRow()],
        movements: [
          movementRow({
            movement_type: movementType,
            base_quantity: quantity,
          }),
        ],
      });

      expect(onlyItem(snapshot)[field]).toBe(expected);
      expect(
        snapshot.movements_7d.event_counts_by_type[
          movementType
        ],
      ).toBe(1);
    },
  );

  it("10. keeps the real identity of inactive items with historical movements", () => {
    const snapshot = derive({
      inventory: [
        inventoryRow(),
        inventoryRow({
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
      movements: [
        movementRow({
          item_id: "item-old-sauce",
          movement_type: "WASTE",
          base_quantity: -2,
          base_unit_id: UNIT_PIECE.base_unit_id,
          reason_code: "EXPIRED",
        }),
      ],
    });

    expect(
      snapshot.inventory.items.map((item) => item.sku),
    ).toEqual(["CHICKEN-BREAST"]);

    expect(
      snapshot.inactive_items_with_activity,
    ).toHaveLength(1);

    expect(
      snapshot.inactive_items_with_activity[0],
    ).toMatchObject({
      item_id: "item-old-sauce",
      sku: "OLD-SAUCE",
      name: "ซอสสูตรเก่า",
      is_active: false,
      unit: { symbol: "pcs" },
      waste_7d: 2,
      movement_event_count_7d: 1,
    });

    expect(JSON.stringify(snapshot)).not.toContain(
      "Unknown item",
    );
    expect(snapshot.data_quality.excluded_row_count).toBe(0);
    expect(snapshot.data_quality.complete).toBe(true);
  });

  it("omits inactive items that have no activity", () => {
    const snapshot = derive({
      inventory: [
        inventoryRow({
          item_id: "item-idle",
          sku: "IDLE",
          is_active: false,
        }),
      ],
    });

    expect(snapshot.inventory.items).toEqual([]);
    expect(snapshot.inactive_items_with_activity).toEqual(
      [],
    );
  });

  it("17. never aggregates quantities across items or units", () => {
    const snapshot = derive({
      inventory: [
        inventoryRow(),
        inventoryRow({
          item_id: "item-egg",
          sku: "EGG",
          name: "ไข่ไก่",
          ...UNIT_PIECE,
          current_quantity: 120,
          minimum_stock: 30,
          reorder_point: 60,
        }),
      ],
      movements: [
        movementRow({ base_quantity: 1000 }),
        movementRow({
          item_id: "item-egg",
          base_quantity: 30,
          base_unit_id: UNIT_PIECE.base_unit_id,
        }),
      ],
    });

    const bySku = Object.fromEntries(
      snapshot.inventory.items.map((item) => [
        item.sku,
        item,
      ]),
    );

    expect(bySku["CHICKEN-BREAST"].stock_in_7d).toBe(1000);
    expect(bySku["CHICKEN-BREAST"].unit.symbol).toBe("g");
    expect(bySku.EGG.stock_in_7d).toBe(30);
    expect(bySku.EGG.unit.symbol).toBe("pcs");

    // Snapshot-level sections hold counts only, never summed quantities.
    const counts = [
      ...Object.values(snapshot.inventory.totals),
      ...Object.values(
        snapshot.movements_7d.event_counts_by_type,
      ),
      snapshot.movements_7d.event_count,
    ];

    for (const value of counts) {
      expect(Number.isInteger(value)).toBe(true);
    }

    expect(snapshot.movements_7d.event_count).toBe(2);
    expect(JSON.stringify(snapshot)).not.toContain("1030");
  });

  it("excludes a movement whose base unit differs from the item base unit", () => {
    const snapshot = derive({
      inventory: [inventoryRow()],
      movements: [
        movementRow({ base_quantity: 1000 }),
        movementRow({
          base_quantity: 5,
          base_unit_id: UNIT_PIECE.base_unit_id,
        }),
      ],
    });

    expect(onlyItem(snapshot).stock_in_7d).toBe(1000);
    expect(
      snapshot.data_quality.excluded_rows
        .movements_unit_mismatch,
    ).toBe(1);
    expect(snapshot.data_quality.complete).toBe(false);
  });

  it("excludes a movement for an item missing from inventory rows", () => {
    const snapshot = derive({
      inventory: [inventoryRow()],
      movements: [
        movementRow({ item_id: "item-missing" }),
      ],
    });

    expect(
      snapshot.data_quality.excluded_rows
        .movements_unknown_item,
    ).toBe(1);
    expect(snapshot.data_quality.complete).toBe(false);
    expect(snapshot.inactive_items_with_activity).toEqual(
      [],
    );
  });

  it("rejects movement types outside the database contract", () => {
    const source = snapshotSource({
      inventory: [inventoryRow()],
      movements: [movementRow()],
    });

    const tampered = {
      ...source,
      movements: [
        {
          ...source.movements[0],
          movement_type: "TRANSFER",
        },
      ],
    };

    expect(() =>
      deriveBusinessSnapshotV2(
        tampered as unknown as typeof source,
      ),
    ).toThrow();
  });
});

describe("Snapshot V2 facts: purchase orders", () => {
  it("11. ordered but not received: full quantity remains open", () => {
    const snapshot = derive({
      inventory: [inventoryRow()],
      purchase_orders: [purchaseOrderRow()],
      purchase_order_lines: [purchaseOrderLineRow()],
    });

    expect(onlyItem(snapshot)).toMatchObject({
      open_po_count: 1,
      open_po_remaining_quantity: 5000,
    });
    expect(snapshot.purchasing).toMatchObject({
      open_po_count: 1,
      ordered_po_count: 1,
      partially_received_po_count: 0,
      open_po_line_count: 1,
    });
  });

  it("12. partial receiving: remaining = ordered - received", () => {
    const snapshot = derive({
      inventory: [inventoryRow()],
      purchase_orders: [
        purchaseOrderRow({
          status: "PARTIALLY_RECEIVED",
        }),
      ],
      purchase_order_lines: [
        purchaseOrderLineRow({
          received_base_quantity: 2000,
          po_status: "PARTIALLY_RECEIVED",
        }),
      ],
    });

    expect(onlyItem(snapshot)).toMatchObject({
      open_po_count: 1,
      open_po_remaining_quantity: 3000,
    });
    expect(snapshot.purchasing).toMatchObject({
      open_po_count: 1,
      ordered_po_count: 0,
      partially_received_po_count: 1,
    });
  });

  it("13. fully received: nothing remains open", () => {
    const received = derive({
      inventory: [inventoryRow()],
      purchase_orders: [
        purchaseOrderRow({ status: "RECEIVED" }),
      ],
      purchase_order_lines: [
        purchaseOrderLineRow({
          received_base_quantity: 5000,
          po_status: "RECEIVED",
        }),
      ],
    });

    expect(onlyItem(received)).toMatchObject({
      open_po_count: 0,
      open_po_remaining_quantity: 0,
    });
    expect(received.purchasing).toMatchObject({
      open_po_count: 0,
      received_po_count: 1,
    });

    // A fully received line on a partially received PO is not open either.
    const lineDone = derive({
      inventory: [inventoryRow()],
      purchase_order_lines: [
        purchaseOrderLineRow({
          received_base_quantity: 5000,
          po_status: "PARTIALLY_RECEIVED",
        }),
      ],
    });

    expect(onlyItem(lineDone)).toMatchObject({
      open_po_count: 0,
      open_po_remaining_quantity: 0,
    });
  });

  it("ignores DRAFT and CANCELLED purchase order lines", () => {
    const item = onlyItem(
      derive({
        inventory: [inventoryRow()],
        purchase_order_lines: [
          purchaseOrderLineRow({
            id: "pol-draft",
            po_status: "DRAFT",
          }),
          purchaseOrderLineRow({
            id: "pol-cancelled",
            po_status: "CANCELLED",
            received_base_quantity: 1000,
          }),
        ],
      }),
    );

    expect(item.open_po_count).toBe(0);
    expect(item.open_po_remaining_quantity).toBe(0);
  });

  it("14. open_po_remaining_quantity is never negative", () => {
    const item = onlyItem(
      derive({
        inventory: [inventoryRow()],
        purchase_order_lines: [
          purchaseOrderLineRow({
            ordered_base_quantity: 1000,
            received_base_quantity: 1500,
            po_status: "PARTIALLY_RECEIVED",
          }),
        ],
      }),
    );

    expect(item.open_po_remaining_quantity).toBe(0);
    expect(item.open_po_count).toBe(0);
  });

  it("sums remaining quantity across several open POs for one item", () => {
    const item = onlyItem(
      derive({
        inventory: [inventoryRow()],
        purchase_order_lines: [
          purchaseOrderLineRow({
            id: "pol-1",
            purchase_order_id: "po-1",
          }),
          purchaseOrderLineRow({
            id: "pol-2",
            purchase_order_id: "po-2",
            ordered_base_quantity: 3000,
            received_base_quantity: 1000,
            po_status: "PARTIALLY_RECEIVED",
          }),
        ],
      }),
    );

    expect(item.open_po_count).toBe(2);
    expect(item.open_po_remaining_quantity).toBe(7000);
  });

  it("15. reorder required and covered by an open PO (6500 / 7000 / 5000)", () => {
    const snapshot = derive({
      inventory: [
        inventoryRow({
          current_quantity: 6500,
          stock_status: "LOW_STOCK",
        }),
      ],
      purchase_order_lines: [purchaseOrderLineRow()],
    });

    expect(onlyItem(snapshot)).toMatchObject({
      reorder_required: true,
      open_po_remaining_quantity: 5000,
      quantity_including_open_po: 11500,
      reorder_covered_by_open_po: true,
    });
    expect(
      snapshot.inventory.totals
        .reorder_covered_by_open_po_count,
    ).toBe(1);
  });

  it.each([
    ["no open PO", []],
    [
      "open PO too small (6500 + 400 <= 7000)",
      [
        purchaseOrderLineRow({
          ordered_base_quantity: 400,
        }),
      ],
    ],
    [
      "open PO reaches exactly the reorder point (6500 + 500)",
      [
        purchaseOrderLineRow({
          ordered_base_quantity: 500,
        }),
      ],
    ],
  ])(
    "16. reorder required but not covered: %s",
    (_label, lines) => {
      const item = onlyItem(
        derive({
          inventory: [
            inventoryRow({
              current_quantity: 6500,
              stock_status: "LOW_STOCK",
            }),
          ],
          purchase_order_lines: lines,
        }),
      );

      expect(item.reorder_required).toBe(true);
      expect(item.reorder_covered_by_open_po).toBe(false);
    },
  );

  it("an open PO never changes reorder_required", () => {
    const required = onlyItem(
      derive({
        inventory: [
          inventoryRow({
            current_quantity: 6500,
            stock_status: "LOW_STOCK",
          }),
        ],
        purchase_order_lines: [
          purchaseOrderLineRow({
            ordered_base_quantity: 100000,
          }),
        ],
      }),
    );

    expect(required.reorder_required).toBe(true);

    const notRequired = onlyItem(
      derive({
        inventory: [inventoryRow()],
        purchase_order_lines: [purchaseOrderLineRow()],
      }),
    );

    expect(notRequired.reorder_required).toBe(false);
    expect(notRequired.reorder_covered_by_open_po).toBe(
      false,
    );
  });

  it("keeps open PO quantity for an inactive item with its real identity", () => {
    const snapshot = derive({
      inventory: [
        inventoryRow({
          item_id: "item-old",
          sku: "OLD-ITEM",
          is_active: false,
        }),
      ],
      purchase_order_lines: [
        purchaseOrderLineRow({ item_id: "item-old" }),
      ],
    });

    expect(snapshot.inactive_items_with_activity).toEqual([
      expect.objectContaining({
        sku: "OLD-ITEM",
        open_po_remaining_quantity: 5000,
      }),
    ]);
  });

  it("counts every purchase order status", () => {
    const snapshot = derive({
      purchase_orders: [
        purchaseOrderRow({ id: "1", status: "DRAFT" }),
        purchaseOrderRow({ id: "2", status: "ORDERED" }),
        purchaseOrderRow({ id: "3", status: "ORDERED" }),
        purchaseOrderRow({
          id: "4",
          status: "PARTIALLY_RECEIVED",
        }),
        purchaseOrderRow({ id: "5", status: "RECEIVED" }),
        purchaseOrderRow({ id: "6", status: "CANCELLED" }),
      ],
    });

    expect(snapshot.purchasing).toEqual({
      total_po_count: 6,
      status_counts: {
        DRAFT: 1,
        ORDERED: 2,
        PARTIALLY_RECEIVED: 1,
        RECEIVED: 1,
        CANCELLED: 1,
      },
      open_po_count: 3,
      ordered_po_count: 2,
      partially_received_po_count: 1,
      received_po_count: 1,
      open_po_line_count: 0,
    });
  });
});

describe("Snapshot V2 facts: availability, empty data and quality", () => {
  it("18/19. usage rate and forecast are never available in V1.1", () => {
    const snapshot = derive({
      inventory: [
        inventoryRow(),
        inventoryRow({
          item_id: "item-old",
          sku: "OLD",
          is_active: false,
        }),
      ],
      movements: [movementRow({ item_id: "item-old" })],
    });

    expect(snapshot.availability).toEqual({
      usage_rate_available: false,
      forecast_available: false,
    });

    for (const item of [
      ...snapshot.inventory.items,
      ...snapshot.inactive_items_with_activity,
    ]) {
      expect(item.usage_rate_available).toBe(false);
      expect(item.forecast_available).toBe(false);
    }

    const json = JSON.stringify(snapshot);

    expect(json).not.toMatch(/days_to_stockout|forecast_quantity|usage_rate":/);
  });

  it("20. empty datasets produce an empty, complete snapshot", () => {
    const snapshot = derive({});

    expect(snapshot.inventory.items).toEqual([]);
    expect(snapshot.inactive_items_with_activity).toEqual(
      [],
    );
    expect(snapshot.inventory.totals.active_item_count).toBe(
      0,
    );
    expect(snapshot.movements_7d.event_count).toBe(0);
    expect(
      snapshot.movements_7d.waste_reason_event_counts,
    ).toEqual({});
    expect(snapshot.purchasing.total_po_count).toBe(0);
    expect(snapshot.data_quality.complete).toBe(true);
  });

  it("22. complete only when every dataset is complete and no rows were excluded", () => {
    const complete = derive({ inventory: [inventoryRow()] });

    expect(complete.data_quality).toMatchObject({
      complete: true,
      generated_at: GENERATED_AT,
      inventory_rows_complete: true,
      movement_rows_complete: true,
      purchase_order_rows_complete: true,
      excluded_row_count: 0,
    });

    const incomplete = {
      expected_rows: 1001,
      rows_read: 1000,
      complete: false,
      incomplete_reason: "ROW_COUNT_MISMATCH",
    };

    const movementsIncomplete = derive({
      inventory: [inventoryRow()],
      datasets: { movements: incomplete },
    });

    expect(movementsIncomplete.data_quality).toMatchObject({
      complete: false,
      movement_rows_complete: false,
      inventory_rows_complete: true,
    });
    expect(
      movementsIncomplete.data_quality.datasets.movements,
    ).toEqual(incomplete);

    const linesIncomplete = derive({
      datasets: { purchase_order_lines: incomplete },
    });

    expect(linesIncomplete.data_quality).toMatchObject({
      complete: false,
      purchase_order_rows_complete: false,
    });

    const ordersIncomplete = derive({
      datasets: { purchase_orders: incomplete },
    });

    expect(
      ordersIncomplete.data_quality
        .purchase_order_rows_complete,
    ).toBe(false);

    const inventoryIncomplete = derive({
      datasets: { inventory: incomplete },
    });

    expect(inventoryIncomplete.data_quality).toMatchObject({
      complete: false,
      inventory_rows_complete: false,
    });
  });

  it("output always matches the BusinessSnapshotV2 schema", () => {
    const snapshot = derive({
      inventory: [inventoryRow()],
      movements: [movementRow()],
      purchase_orders: [purchaseOrderRow()],
      purchase_order_lines: [purchaseOrderLineRow()],
    });

    expect(
      businessSnapshotV2Schema.safeParse(snapshot).success,
    ).toBe(true);
    expect(snapshot.version).toBe(2);
    expect(snapshot.scope).toEqual({ type: "GLOBAL" });
    expect(snapshot.window.days).toBe(7);
  });
});

describe("Snapshot V2 facts: determinism", () => {
  const rows: SourceRows = {
    inventory: [
      inventoryRow(),
      inventoryRow({
        item_id: "item-egg",
        sku: "EGG",
        name: "ไข่ไก่",
        ...UNIT_PIECE,
        current_quantity: 40,
        minimum_stock: 30,
        reorder_point: 60,
        stock_status: "LOW_STOCK",
      }),
      inventoryRow({
        item_id: "item-old",
        sku: "OLD",
        is_active: false,
      }),
    ],
    movements: [
      movementRow({ base_quantity: 0.1 }),
      movementRow({ base_quantity: 0.2 }),
      movementRow({
        movement_type: "WASTE",
        base_quantity: -1100,
        reason_code: "SPOILED",
      }),
      movementRow({
        item_id: "item-egg",
        movement_type: "WASTE",
        base_quantity: -3,
        base_unit_id: UNIT_PIECE.base_unit_id,
        reason_code: "DAMAGED",
      }),
      movementRow({
        item_id: "item-old",
        movement_type: "COUNT_ADJUSTMENT",
        base_quantity: -200,
      }),
    ],
    purchase_orders: [
      purchaseOrderRow({ id: "po-1" }),
      purchaseOrderRow({
        id: "po-2",
        status: "PARTIALLY_RECEIVED",
      }),
    ],
    purchase_order_lines: [
      purchaseOrderLineRow({
        id: "pol-1",
        item_id: "item-egg",
        ordered_base_quantity: 60,
      }),
      purchaseOrderLineRow({
        id: "pol-2",
        purchase_order_id: "po-2",
        received_base_quantity: 1000,
        po_status: "PARTIALLY_RECEIVED",
      }),
    ],
  };

  it("23. the same input produces byte-identical output", () => {
    const first = JSON.stringify(derive(rows));
    const second = JSON.stringify(derive(rows));

    expect(second).toBe(first);
  });

  it("output does not depend on input row order", () => {
    const reversed: SourceRows = {
      inventory: [...(rows.inventory ?? [])].reverse(),
      movements: [...(rows.movements ?? [])].reverse(),
      purchase_orders: [
        ...(rows.purchase_orders ?? []),
      ].reverse(),
      purchase_order_lines: [
        ...(rows.purchase_order_lines ?? []),
      ].reverse(),
    };

    expect(JSON.stringify(derive(reversed))).toBe(
      JSON.stringify(derive(rows)),
    );
  });

  it("sorts items by SKU and does not mutate its input", () => {
    const source = deepFreeze(snapshotSource(rows));

    const snapshot = deriveBusinessSnapshotV2(source);

    expect(
      snapshot.inventory.items.map((item) => item.sku),
    ).toEqual(["CHICKEN-BREAST", "EGG"]);
    expect(
      Object.keys(
        snapshot.movements_7d.waste_reason_event_counts,
      ),
    ).toEqual(["DAMAGED", "SPOILED"]);
  });
});
