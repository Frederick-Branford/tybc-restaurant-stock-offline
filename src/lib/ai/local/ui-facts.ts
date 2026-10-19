// UI-safe fact projection for Local AI responses.
//
// Pure and deterministic. Takes the authoritative Business Snapshot V2 and
// the LocalDigest that was sent to the model, and returns only the facts the
// UI needs to render numbers next to the model's notes:
// - only SKUs that were in the digest (the only SKUs validated model output
//   can reference), in digest rank order;
// - no database ids (item or unit), no raw movements or purchase orders, no
//   notes, users or suppliers.
// The model is never the source of these values.

import {
  localDigestSchema,
  type LocalDigest,
} from "@/lib/ai/local/digest";

import {
  localAiUiFactsSchema,
  type LocalAiUiFactItem,
  type LocalAiUiFacts,
} from "@/lib/ai/local/api-contract";

import {
  businessSnapshotV2Schema,
  MOVEMENT_WINDOW_DAYS,
  type BusinessSnapshotV2,
  type ItemFacts,
} from "@/lib/ai/snapshot/facts";

function toUiFactItem(item: ItemFacts): LocalAiUiFactItem {
  return {
    sku: item.sku,
    name: item.name,
    unit: {
      code: item.unit.code,
      symbol: item.unit.symbol,
    },
    stock_status: item.stock_status,
    current_quantity: item.current_quantity,
    reorder_point: item.reorder_point,
    minimum_stock: item.minimum_stock,
    reorder_required: item.reorder_required,
    reorder_covered_by_open_po:
      item.reorder_covered_by_open_po,
    waste_7d: item.waste_7d,
    adjustment_7d: item.adjustment_7d,
    open_po_remaining_quantity:
      item.open_po_remaining_quantity,
  };
}

export function buildLocalAiUiFacts(
  snapshotInput: BusinessSnapshotV2,
  digestInput: LocalDigest,
): LocalAiUiFacts {
  const snapshot =
    businessSnapshotV2Schema.parse(snapshotInput);

  const digest = localDigestSchema.parse(digestInput);

  const activeBySku = new Map(
    snapshot.inventory.items.map((item) => [item.sku, item]),
  );

  const items: LocalAiUiFactItem[] = [];

  for (const digestItem of digest.items) {
    const facts = activeBySku.get(digestItem.sku);

    if (facts) {
      items.push(toUiFactItem(facts));
    }
  }

  return localAiUiFactsSchema.parse({
    movement_window_days: MOVEMENT_WINDOW_DAYS,
    items,
    data_quality: {
      complete: digest.data_complete,
      stock_status_consistent:
        digest.stock_status_consistent,
      omitted_count: digest.omitted_count,
    },
  });
}
