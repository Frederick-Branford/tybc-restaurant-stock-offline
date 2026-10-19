// Local AI semantic validation.
//
// Zod checks the shape of the model output. This module checks it against
// the digest the model was given, so model text can never introduce an
// item, a signal or a number that the server did not provide.
//
// Pure and deterministic: no I/O, no clock, inputs are never mutated.
//
// What is checked:
// - attention.sku must be one of the SKUs included in the digest;
// - attention.signal must be one of that SKU's digest signals;
// - (sku, signal) pairs are de-duplicated, first accepted entry wins;
// - every text field is trimmed; empty text is dropped;
// - numeric-text policy: any decimal digit (Unicode category Nd, which
//   covers 0-9, Thai ๐-๙ and other scripts) left after removing digest
//   SKUs and waste reason codes is treated as an unsupported numeric claim.
//   An attention entry or action with such a claim is dropped; an overview
//   with one is replaced by null. The rest of the response is kept.
// - server_data_limits are derived from the digest only. The model output
//   has no data_limits field (an extra key fails the Zod schema), so the
//   model can neither add nor remove a data limitation.
//
// What is NOT checked:
// - numbers written as words ("สามรายการ", "ten");
// - non-numeric factual claims in prose, including claims about forecasts
//   or usage (most such claims need numbers, which the digit rule drops);
// - tone, language or relevance of the text.
//
// The model output cannot change stock status, reorder_required, PO
// coverage or data completeness: the output schema has no such fields and
// the UI reads those facts from Snapshot V2.

import {
  localDigestSchema,
  type LocalAiSignal,
  type LocalDigest,
} from "@/lib/ai/local/digest";

import { localAiOutputSchema } from "@/lib/ai/local/schema";

export const SERVER_DATA_LIMITS = [
  "DATA_INCOMPLETE",
  "ITEMS_OMITTED",
  "STOCK_STATUS_INCONSISTENT",
  "USAGE_RATE_UNAVAILABLE",
  "FORECAST_UNAVAILABLE",
] as const;

export type ServerDataLimit =
  (typeof SERVER_DATA_LIMITS)[number];

export const DROP_REASONS = [
  "UNKNOWN_SKU",
  "SIGNAL_NOT_IN_DIGEST",
  "EMPTY_TEXT",
  "NUMERIC_CLAIM",
  "DUPLICATE",
] as const;

export type DropReason = (typeof DROP_REASONS)[number];

export type DroppedEntry = {
  field: "overview" | "attention" | "actions";
  index: number;
  reason: DropReason;
};

export type ValidatedAttention = {
  sku: string;
  signal: LocalAiSignal;
  note: string;
};

export type ValidatedLocalAiOutput = {
  overview: string | null;
  attention: ValidatedAttention[];
  actions: string[];
  server_data_limits: ServerDataLimit[];
  dropped: DroppedEntry[];
};

export type LocalAiValidationResult =
  | { ok: true; value: ValidatedLocalAiOutput }
  | {
      ok: false;
      reason: "SCHEMA_INVALID";
      issues: string[];
    };

const DECIMAL_DIGIT = /\p{Nd}/u;

function compareText(a: string, b: string): number {
  if (a < b) {
    return -1;
  }

  if (a > b) {
    return 1;
  }

  return 0;
}

/**
 * Identifiers the model may legitimately repeat even if they contain
 * digits (for example SKU "MILK-1L"). Longest first, so a longer SKU is
 * removed before a shorter one it contains.
 */
export function allowedIdentifierTokens(
  digest: LocalDigest,
): string[] {
  const tokens = new Set<string>([
    ...digest.items.map((item) => item.sku),
    ...digest.waste_reasons,
  ]);

  return [...tokens].sort(
    (a, b) => b.length - a.length || compareText(a, b),
  );
}

/**
 * True when `text` still contains a decimal digit after every allowed
 * identifier has been removed.
 */
export function containsNumericClaim(
  text: string,
  allowedTokens: readonly string[],
): boolean {
  let remaining = text;

  for (const token of allowedTokens) {
    if (token.length > 0) {
      remaining = remaining.split(token).join(" ");
    }
  }

  return DECIMAL_DIGIT.test(remaining);
}

export function serverDataLimits(
  digest: LocalDigest,
): ServerDataLimit[] {
  const limits: ServerDataLimit[] = [];

  if (!digest.data_complete) {
    limits.push("DATA_INCOMPLETE");
  }

  if (digest.omitted_count > 0) {
    limits.push("ITEMS_OMITTED");
  }

  if (!digest.stock_status_consistent) {
    limits.push("STOCK_STATUS_INCONSISTENT");
  }

  if (!digest.usage_rate_available) {
    limits.push("USAGE_RATE_UNAVAILABLE");
  }

  if (!digest.forecast_available) {
    limits.push("FORECAST_UNAVAILABLE");
  }

  return limits;
}

type TextCheck =
  | { ok: true; text: string }
  | { ok: false; reason: DropReason };

function checkText(
  raw: string,
  allowedTokens: readonly string[],
): TextCheck {
  const text = raw.trim();

  if (text.length === 0) {
    return { ok: false, reason: "EMPTY_TEXT" };
  }

  if (containsNumericClaim(text, allowedTokens)) {
    return { ok: false, reason: "NUMERIC_CLAIM" };
  }

  return { ok: true, text };
}

function validateTextList(
  field: "actions",
  values: readonly string[],
  allowedTokens: readonly string[],
  dropped: DroppedEntry[],
): string[] {
  const accepted: string[] = [];

  values.forEach((value, index) => {
    const check = checkText(value, allowedTokens);

    if (!check.ok) {
      dropped.push({ field, index, reason: check.reason });
      return;
    }

    if (accepted.includes(check.text)) {
      dropped.push({ field, index, reason: "DUPLICATE" });
      return;
    }

    accepted.push(check.text);
  });

  return accepted;
}

/**
 * Validates raw model output against the digest the model was given.
 * Returns SCHEMA_INVALID when the output does not match the Zod schema;
 * otherwise returns the surviving content plus a record of what was
 * dropped and why.
 */
export function validateLocalAiOutput({
  output,
  digest: digestInput,
}: {
  output: unknown;
  digest: LocalDigest;
}): LocalAiValidationResult {
  const digest = localDigestSchema.parse(digestInput);

  const parsed = localAiOutputSchema.safeParse(output);

  if (!parsed.success) {
    return {
      ok: false,
      reason: "SCHEMA_INVALID",
      issues: parsed.error.issues.map(
        (issue) =>
          `${issue.path.map(String).join(".") || "(root)"}: ${issue.message}`,
      ),
    };
  }

  const allowedTokens = allowedIdentifierTokens(digest);

  const signalsBySku = new Map<
    string,
    ReadonlySet<LocalAiSignal>
  >(
    digest.items.map((item) => [
      item.sku,
      new Set(item.signals),
    ]),
  );

  const dropped: DroppedEntry[] = [];

  const overviewCheck = checkText(
    parsed.data.overview,
    allowedTokens,
  );

  if (!overviewCheck.ok) {
    dropped.push({
      field: "overview",
      index: 0,
      reason: overviewCheck.reason,
    });
  }

  const attention: ValidatedAttention[] = [];
  const acceptedPairs = new Set<string>();

  parsed.data.attention.forEach((entry, index) => {
    const sku = entry.sku.trim();
    const digestSignals = signalsBySku.get(sku);

    if (!digestSignals) {
      dropped.push({
        field: "attention",
        index,
        reason: "UNKNOWN_SKU",
      });
      return;
    }

    if (!digestSignals.has(entry.signal)) {
      dropped.push({
        field: "attention",
        index,
        reason: "SIGNAL_NOT_IN_DIGEST",
      });
      return;
    }

    const note = checkText(entry.note, allowedTokens);

    if (!note.ok) {
      dropped.push({
        field: "attention",
        index,
        reason: note.reason,
      });
      return;
    }

    const pair = `${sku}\u0000${entry.signal}`;

    if (acceptedPairs.has(pair)) {
      dropped.push({
        field: "attention",
        index,
        reason: "DUPLICATE",
      });
      return;
    }

    acceptedPairs.add(pair);
    attention.push({
      sku,
      signal: entry.signal,
      note: note.text,
    });
  });

  return {
    ok: true,
    value: {
      overview: overviewCheck.ok
        ? overviewCheck.text
        : null,
      attention,
      actions: validateTextList(
        "actions",
        parsed.data.actions,
        allowedTokens,
        dropped,
      ),
      server_data_limits: serverDataLimits(digest),
      dropped,
    },
  };
}
