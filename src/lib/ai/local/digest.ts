// Local AI digest: the compact, model-facing view of Business Snapshot V2.
//
// Pure and deterministic. No I/O, no clock, no randomness, no environment.
// The same snapshot always produces the same digest, byte for byte,
// regardless of item order in the snapshot.
//
// What the model receives:
// - SKUs (opaque identifiers, re-checked against the database SKU format),
// - signal enums, stock status, and reorder/open-PO booleans,
// - data-availability flags and item counts.
//
// What the model never receives:
// - quantities (current, reorder point, waste, adjustment, PO remaining):
//   the UI renders those from Snapshot V2, never from generated text,
// - item names (user-entered free text, a prompt-injection vector),
// - database ids, units, notes, users, suppliers and timestamps.
//
// Ranking and truncation happen here, in code. The model never ranks.

import { z } from "zod";

import {
  businessSnapshotV2Schema,
  STOCK_STATUSES,
  type BusinessSnapshotV2,
  type ItemFacts,
} from "@/lib/ai/snapshot/facts";

// ============================================================
// Signals
// ============================================================

// Ordered by severity: index 0 is the most severe.
export const LOCAL_AI_SIGNALS = [
  "OUT_OF_STOCK",
  "LOW_STOCK",
  "BELOW_MINIMUM",
  "WASTE",
  "ADJUSTMENT",
] as const;

export type LocalAiSignal =
  (typeof LOCAL_AI_SIGNALS)[number];

export const localAiSignalSchema = z.enum(LOCAL_AI_SIGNALS);

function signalSeverity(signal: LocalAiSignal): number {
  return LOCAL_AI_SIGNALS.indexOf(signal);
}

/**
 * Signals for one item, most severe first. Derived only from Snapshot V2
 * facts; no thresholds are added here.
 */
export function deriveItemSignals(
  item: ItemFacts,
): LocalAiSignal[] {
  const signals: LocalAiSignal[] = [];

  if (item.stock_status === "OUT_OF_STOCK") {
    signals.push("OUT_OF_STOCK");
  }

  if (item.stock_status === "LOW_STOCK") {
    signals.push("LOW_STOCK");
  }

  if (item.below_minimum) {
    signals.push("BELOW_MINIMUM");
  }

  if (item.waste_7d > 0) {
    signals.push("WASTE");
  }

  if (item.adjustment_7d !== 0) {
    signals.push("ADJUSTMENT");
  }

  return signals;
}

// ============================================================
// Size budget
// ============================================================

// Budget rationale (num_ctx = 2048, shared by prompt and output):
// the system prompt is about 1.8k ASCII characters, the digest at most
// 2.4k, which leaves roughly half the context for Thai JSON output. This is
// an estimate, not a tokenizer: Phase 3 checks the real prompt token count
// reported by the model runtime.

// At most this many items are sent to the model (the output itself
// may reference at most 4).
export const LOCAL_DIGEST_MAX_ITEMS = 8;

// SKUs longer than this are not sent (bounded per-item size).
export const LOCAL_DIGEST_MAX_SKU_LENGTH = 48;

// Hard cap on JSON.stringify(digest).length. Digest JSON is ASCII only
// (SKUs, enum codes, booleans, small integers), so characters = bytes.
export const LOCAL_DIGEST_MAX_JSON_CHARS = 2400;

// At most this many waste reason codes, most frequent first, no counts.
export const LOCAL_DIGEST_MAX_WASTE_REASONS = 3;

// Same format as the items.sku CHECK constraint in the database.
export const SKU_PATTERN = /^[A-Z0-9][A-Z0-9_-]*$/;

// Same format as reason codes in the database.
const REASON_CODE_PATTERN = /^[A-Z][A-Z0-9_]*$/;

const REASON_CODE_MAX_LENGTH = 32;

// ============================================================
// Digest schema
// ============================================================

const countSchema = z.number().int().nonnegative();

export const localDigestItemSchema = z.strictObject({
  sku: z
    .string()
    .max(LOCAL_DIGEST_MAX_SKU_LENGTH)
    .regex(SKU_PATTERN),
  signals: z.array(localAiSignalSchema).min(1),
  stock_status: z.enum(STOCK_STATUSES),
  reorder_required: z.boolean(),
  reorder_covered_by_open_po: z.boolean(),
  has_open_po: z.boolean(),
  adjustment_direction: z
    .enum(["DECREASE", "INCREASE"])
    .nullable(),
});

export const localDigestSchema = z.strictObject({
  format: z.literal("local-digest-v1"),

  // True only when every Snapshot V2 dataset read was proven complete and
  // no rows were excluded. It does NOT mean the datasets were read in one
  // database transaction.
  data_complete: z.boolean(),
  stock_status_consistent: z.boolean(),
  usage_rate_available: z.literal(false),
  forecast_available: z.literal(false),

  active_item_count: countSchema,
  signal_counts: z.strictObject({
    OUT_OF_STOCK: countSchema,
    LOW_STOCK: countSchema,
    BELOW_MINIMUM: countSchema,
    WASTE: countSchema,
    ADJUSTMENT: countSchema,
  }),
  items_with_signals: countSchema,
  included_count: countSchema,
  omitted_count: countSchema,

  waste_reasons: z
    .array(
      z
        .string()
        .max(REASON_CODE_MAX_LENGTH)
        .regex(REASON_CODE_PATTERN),
    )
    .max(LOCAL_DIGEST_MAX_WASTE_REASONS),

  items: z
    .array(localDigestItemSchema)
    .max(LOCAL_DIGEST_MAX_ITEMS),
});

export type LocalDigestItem = z.infer<
  typeof localDigestItemSchema
>;

export type LocalDigest = z.infer<typeof localDigestSchema>;

// ============================================================
// Ranking
// ============================================================

type RankedItem = {
  facts: ItemFacts;
  signals: LocalAiSignal[];
};

function compareText(a: string, b: string): number {
  if (a < b) {
    return -1;
  }

  if (a > b) {
    return 1;
  }

  return 0;
}

function compareSignalLists(
  a: LocalAiSignal[],
  b: LocalAiSignal[],
): number {
  const length = Math.min(a.length, b.length);

  for (let index = 0; index < length; index += 1) {
    const difference =
      signalSeverity(a[index]) - signalSeverity(b[index]);

    if (difference !== 0) {
      return difference;
    }
  }

  // Same leading signals: the item with more signals ranks first.
  return b.length - a.length;
}

function uncoveredReorderRank(item: ItemFacts): number {
  return item.reorder_required &&
    !item.reorder_covered_by_open_po
    ? 0
    : 1;
}

/**
 * Deterministic ranking, most important first:
 * 1. most severe signal (OUT_OF_STOCK > LOW_STOCK > BELOW_MINIMUM >
 *    WASTE > ADJUSTMENT);
 * 2. reorder required and NOT covered by an open PO, before covered;
 * 3. remaining signals compared in severity order; more signals first;
 * 4. SKU ascending (code-unit order; SKUs are unique).
 *
 * Quantities are never compared: items use different units, so
 * "1000 g below" and "5 pcs below" are not comparable.
 */
export function compareRankedItems(
  a: RankedItem,
  b: RankedItem,
): number {
  return (
    signalSeverity(a.signals[0]) -
      signalSeverity(b.signals[0]) ||
    uncoveredReorderRank(a.facts) -
      uncoveredReorderRank(b.facts) ||
    compareSignalLists(a.signals, b.signals) ||
    compareText(a.facts.sku, b.facts.sku)
  );
}

function toDigestItem(
  ranked: RankedItem,
): LocalDigestItem {
  const { facts, signals } = ranked;

  return {
    sku: facts.sku,
    signals,
    stock_status: facts.stock_status,
    reorder_required: facts.reorder_required,
    reorder_covered_by_open_po:
      facts.reorder_covered_by_open_po,
    has_open_po: facts.open_po_count > 0,
    adjustment_direction:
      facts.adjustment_7d < 0
        ? "DECREASE"
        : facts.adjustment_7d > 0
          ? "INCREASE"
          : null,
  };
}

function isSafeSku(sku: string): boolean {
  return (
    sku.length <= LOCAL_DIGEST_MAX_SKU_LENGTH &&
    SKU_PATTERN.test(sku)
  );
}

function topWasteReasons(
  counts: Record<string, number>,
): string[] {
  return Object.entries(counts)
    .filter(
      ([code]) =>
        code.length <= REASON_CODE_MAX_LENGTH &&
        REASON_CODE_PATTERN.test(code),
    )
    .sort(
      ([codeA, countA], [codeB, countB]) =>
        countB - countA || compareText(codeA, codeB),
    )
    .slice(0, LOCAL_DIGEST_MAX_WASTE_REASONS)
    .map(([code]) => code);
}

// ============================================================
// Digest
// ============================================================

/**
 * Reduces Business Snapshot V2 to the compact digest sent to the local
 * model. Only active items are considered. Items are ranked in code, the
 * top LOCAL_DIGEST_MAX_ITEMS are kept, and the result is trimmed from the
 * lowest rank until it fits LOCAL_DIGEST_MAX_JSON_CHARS. Every relevant
 * item that is not included is counted in omitted_count.
 *
 * `budget` can only tighten the limits (for example for a smaller model
 * context in Phase 3); it can never raise them above the constants.
 */
export type LocalDigestBudget = {
  maxItems?: number;
  maxJsonChars?: number;
};

export function buildLocalDigest(
  snapshotInput: BusinessSnapshotV2,
  budget: LocalDigestBudget = {},
): LocalDigest {
  const maxItems = Math.min(
    budget.maxItems ?? LOCAL_DIGEST_MAX_ITEMS,
    LOCAL_DIGEST_MAX_ITEMS,
  );

  const maxJsonChars = Math.min(
    budget.maxJsonChars ?? LOCAL_DIGEST_MAX_JSON_CHARS,
    LOCAL_DIGEST_MAX_JSON_CHARS,
  );

  const snapshot =
    businessSnapshotV2Schema.parse(snapshotInput);

  const signalCounts = Object.fromEntries(
    LOCAL_AI_SIGNALS.map((signal) => [signal, 0]),
  ) as Record<LocalAiSignal, number>;

  const relevant: RankedItem[] = [];

  for (const facts of snapshot.inventory.items) {
    const signals = deriveItemSignals(facts);

    if (signals.length === 0) {
      continue;
    }

    for (const signal of signals) {
      signalCounts[signal] += 1;
    }

    relevant.push({ facts, signals });
  }

  const eligible = relevant
    .filter((ranked) => isSafeSku(ranked.facts.sku))
    .sort(compareRankedItems);

  let items = eligible
    .slice(0, Math.max(0, maxItems))
    .map(toDigestItem);

  const build = (included: LocalDigestItem[]): LocalDigest => ({
    format: "local-digest-v1",
    data_complete: snapshot.data_quality.complete,
    stock_status_consistent:
      snapshot.data_quality.stock_status_mismatch_count ===
      0,
    usage_rate_available:
      snapshot.availability.usage_rate_available,
    forecast_available:
      snapshot.availability.forecast_available,
    active_item_count: snapshot.inventory.items.length,
    signal_counts: signalCounts,
    items_with_signals: relevant.length,
    included_count: included.length,
    omitted_count: relevant.length - included.length,
    waste_reasons: topWasteReasons(
      snapshot.movements_7d.waste_reason_event_counts,
    ),
    items: included,
  });

  let digest = build(items);

  while (
    items.length > 0 &&
    JSON.stringify(digest).length > maxJsonChars
  ) {
    items = items.slice(0, -1);
    digest = build(items);
  }

  return localDigestSchema.parse(digest);
}
