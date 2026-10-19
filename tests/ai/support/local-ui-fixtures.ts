import type {
  LocalAiSummaryResponse,
  LocalAiUiFactItem,
} from "@/lib/ai/local/api-contract";

// Fixtures for the Local AI Reports card. Each call returns fresh objects.

export function chickenFacts(
  overrides: Partial<LocalAiUiFactItem> = {},
): LocalAiUiFactItem {
  return {
    sku: "CHICKEN-BREAST",
    name: "อกไก่",
    unit: { code: "G", symbol: "g" },
    stock_status: "NORMAL",
    current_quantity: 11700,
    reorder_point: 7000,
    minimum_stock: 3000,
    reorder_required: false,
    reorder_covered_by_open_po: false,
    waste_7d: 600,
    adjustment_7d: 0,
    open_po_remaining_quantity: 0,
    ...overrides,
  };
}

export function basilFacts(
  overrides: Partial<LocalAiUiFactItem> = {},
): LocalAiUiFactItem {
  return {
    sku: "THAI-BASIL",
    name: "ใบกะเพรา",
    unit: { code: "G", symbol: "g" },
    stock_status: "LOW_STOCK",
    current_quantity: 800,
    reorder_point: 1000,
    minimum_stock: 500,
    reorder_required: true,
    reorder_covered_by_open_po: true,
    waste_7d: 0,
    adjustment_7d: -150,
    open_po_remaining_quantity: 2000,
    ...overrides,
  };
}

export const FIXTURE_OVERVIEW =
  "สต็อกโดยรวมอยู่ในเกณฑ์ปกติ มีของเสียที่ควรติดตาม";
export const FIXTURE_NOTE = "มีของเสียต่อเนื่อง ควรตรวจสอบการจัดเก็บ";
export const FIXTURE_ACTION = "ตรวจสอบวิธีจัดเก็บอกไก่";

// 2026-10-15 14:05 in Asia/Bangkok.
export const FIXTURE_GENERATED_AT = "2026-10-15T07:05:00.000Z";

export function summaryFixture(): LocalAiSummaryResponse {
  return {
    result: {
      overview: FIXTURE_OVERVIEW,
      attention: [
        {
          sku: "CHICKEN-BREAST",
          signal: "WASTE",
          note: FIXTURE_NOTE,
        },
      ],
      actions: [FIXTURE_ACTION],
      server_data_limits: [
        "USAGE_RATE_UNAVAILABLE",
        "FORECAST_UNAVAILABLE",
      ],
    },
    facts: {
      movement_window_days: 7,
      items: [chickenFacts(), basilFacts()],
      data_quality: {
        complete: true,
        stock_status_consistent: true,
        omitted_count: 0,
      },
    },
    meta: {
      provider: "ollama",
      model: "qwen3.5:4b",
      generated_at: FIXTURE_GENERATED_AT,
      duration_ms: 12400,
    },
  };
}

// A response body with fields the contract does not define, at every level.
// None of these strings may ever reach the UI.
export const INJECTED_TEXT = {
  topLevel: "TOP_LEVEL_INJECTED",
  result: "RESULT_INJECTED",
  attention: "ATTENTION_INJECTED",
  fact: "FACT_INJECTED",
  dataQuality: "DATA_QUALITY_INJECTED",
  meta: "META_PROMPT_INJECTED",
  digest: "DIGEST_INJECTED",
} as const;

export function summaryWithUnknownFields(): Record<string, unknown> {
  const summary = summaryFixture();

  return {
    ...summary,
    error: INJECTED_TEXT.topLevel,
    digest: { items: [{ sku: INJECTED_TEXT.digest }] },
    result: {
      ...summary.result,
      raw_text: INJECTED_TEXT.result,
      attention: summary.result.attention.map((entry) => ({
        ...entry,
        quantity_text: INJECTED_TEXT.attention,
      })),
    },
    facts: {
      ...summary.facts,
      items: summary.facts.items.map((item) => ({
        ...item,
        item_id: INJECTED_TEXT.fact,
      })),
      data_quality: {
        ...summary.facts.data_quality,
        note: INJECTED_TEXT.dataQuality,
      },
    },
    meta: {
      ...summary.meta,
      prompt: INJECTED_TEXT.meta,
      base_url: "http://127.0.0.1:11434",
    },
  };
}
