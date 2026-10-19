import { describe, expect, it } from "vitest";

import { localAiUiFactsSchema } from "@/lib/ai/local/api-contract";
import { buildLocalDigest } from "@/lib/ai/local/digest";
import { buildLocalAiUiFacts } from "@/lib/ai/local/ui-facts";

import {
  deepFreeze,
  snapshotFor,
  type ItemSpec,
} from "./support/local-fixtures";

const ITEM_IDS = {
  chicken: "3f6b2c1e-8d4a-4b7f-9e21-6a5d0c9b8e7f",
  milk: "9a1d7e55-0c3b-4f2e-a8d6-1b2c3d4e5f60",
};

const SPECS: ItemSpec[] = [
  {
    sku: "CHICKEN-BREAST",
    itemId: ITEM_IDS.chicken,
    name: "อกไก่",
    status: "LOW_STOCK",
    waste: 1100,
    adjustment: -200,
    openPo: 5000,
  },
  {
    sku: "MILK-1L",
    itemId: ITEM_IDS.milk,
    name: "นมสด",
    status: "OUT_OF_STOCK",
  },
  { sku: "RICE", name: "ข้าวสาร" },
];

function build(specs: ItemSpec[] = SPECS) {
  const snapshot = snapshotFor(specs);
  const digest = buildLocalDigest(snapshot);

  return {
    snapshot,
    digest,
    facts: buildLocalAiUiFacts(snapshot, digest),
  };
}

describe("UI-safe Local AI facts", () => {
  it("projects authoritative Snapshot V2 facts for digest items, in digest order", () => {
    const { facts, digest } = build();

    expect(facts.items.map((item) => item.sku)).toEqual(
      digest.items.map((item) => item.sku),
    );
    expect(facts.items.map((item) => item.sku)).toEqual([
      "MILK-1L",
      "CHICKEN-BREAST",
    ]);

    expect(facts.items[1]).toEqual({
      sku: "CHICKEN-BREAST",
      name: "อกไก่",
      unit: { code: "GRAM", symbol: "g" },
      stock_status: "LOW_STOCK",
      current_quantity: 6500,
      reorder_point: 7000,
      minimum_stock: 3000,
      reorder_required: true,
      reorder_covered_by_open_po: true,
      waste_7d: 1100,
      adjustment_7d: -200,
      open_po_remaining_quantity: 5000,
    });
  });

  it("only exposes items that were in the digest", () => {
    const { facts } = build();

    expect(
      facts.items.map((item) => item.sku),
    ).not.toContain("RICE");
  });

  it("never exposes item or unit ids", () => {
    const json = JSON.stringify(build().facts);

    expect(json).not.toContain(ITEM_IDS.chicken);
    expect(json).not.toContain(ITEM_IDS.milk);
    expect(json).not.toContain("unit-g");
    expect(json).not.toMatch(/"(item_id|id)"/);
  });

  it("reports data quality from the digest", () => {
    const many = Array.from({ length: 12 }, (_, index) => ({
      sku: `LOW-${String(index).padStart(2, "0")}`,
      status: "LOW_STOCK" as const,
    }));

    const { facts } = build(many);

    expect(facts.data_quality).toEqual({
      complete: true,
      stock_status_consistent: true,
      omitted_count: 4,
    });
    expect(facts.items).toHaveLength(8);
    expect(facts.movement_window_days).toBe(7);

    const incomplete = snapshotFor(SPECS, {
      datasets: {
        movements: {
          expected_rows: 1001,
          rows_read: 1000,
          complete: false,
          incomplete_reason: "ROW_COUNT_MISMATCH",
        },
      },
    });

    expect(
      buildLocalAiUiFacts(
        incomplete,
        buildLocalDigest(incomplete),
      ).data_quality.complete,
    ).toBe(false);
  });

  it("returns no items for an empty digest", () => {
    const { facts } = build([{ sku: "RICE" }]);

    expect(facts.items).toEqual([]);
  });

  it("is deterministic, schema-valid and does not mutate its inputs", () => {
    const snapshot = deepFreeze(snapshotFor(SPECS));
    const digest = deepFreeze(buildLocalDigest(snapshot));

    const first = buildLocalAiUiFacts(snapshot, digest);
    const second = buildLocalAiUiFacts(snapshot, digest);

    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    expect(localAiUiFactsSchema.safeParse(first).success).toBe(
      true,
    );
  });
});
