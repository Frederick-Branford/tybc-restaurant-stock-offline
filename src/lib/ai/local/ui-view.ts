// Local AI view model for the Reports card.
//
// Client-safe pure module: no server-only, no Supabase, no environment,
// no I/O.
//
// Rules:
// - Every number shown in the card comes from response.facts (Business
//   Snapshot V2). Model text (overview, notes, actions) is rendered as
//   plain text only and is never parsed for numbers.
// - Failure messages are fixed client-side strings chosen by HTTP status.
//   Server-provided error text is never displayed.
// - Responses are parsed with the shared API contract schema, which
//   strips unknown fields before anything reaches the UI.

import {
  localAiSummaryResponseSchema,
  type LocalAiSummaryResponse,
  type LocalAiUiFactItem,
  type LocalAiUiFacts,
} from "@/lib/ai/local/api-contract";
import type { LocalAiSignal } from "@/lib/ai/local/digest";
import type { ServerDataLimit } from "@/lib/ai/local/validate";
import type { StockStatus } from "@/lib/ai/snapshot/facts";

export const LOCAL_AI_SUMMARY_ENDPOINT = "/api/ai/local/summary";

// ============================================================
// Availability (computed on the server from readLocalAiConfig)
// ============================================================

export const LOCAL_AI_AVAILABILITIES = [
  "enabled",
  "disabled",
  "misconfigured",
] as const;

export type LocalAiAvailability =
  (typeof LOCAL_AI_AVAILABILITIES)[number];

// ============================================================
// Response parsing
// ============================================================

/**
 * Validates a 2xx response body against the shared contract. Unknown
 * fields are stripped; anything that does not match returns null.
 */
export function parseLocalAiSummaryResponse(
  body: unknown,
): LocalAiSummaryResponse | null {
  const parsed = localAiSummaryResponseSchema.safeParse(body);

  return parsed.success ? parsed.data : null;
}

// ============================================================
// Failures
// ============================================================

export const LOCAL_AI_FAILURE_MESSAGES = {
  NETWORK:
    "ไม่สามารถติดต่อระบบได้ กรุณาตรวจสอบการเชื่อมต่อแล้วลองใหม่",
  UNAUTHENTICATED:
    "เซสชันหมดอายุหรือยังไม่ได้เข้าสู่ระบบ กรุณาเข้าสู่ระบบใหม่",
  FORBIDDEN: "บัญชีนี้ไม่มีสิทธิ์ใช้งาน AI วิเคราะห์",
  DISABLED: "Local AI ยังไม่ได้เปิดใช้งานบนเครื่องนี้",
  MISCONFIGURED: "การตั้งค่า Local AI บนเครื่องนี้ไม่ถูกต้อง",
  BUSY: "Local AI กำลังวิเคราะห์คำขอก่อนหน้า กรุณารอสักครู่",
  UNREACHABLE: "ไม่สามารถเชื่อมต่อ Local AI ได้ กรุณาตรวจสอบ Ollama",
  TIMEOUT: "Local AI ใช้เวลานานเกินไป กรุณาลองใหม่",
  LOCAL_AI_FAILED:
    "Local AI ไม่สามารถสร้างผลวิเคราะห์ที่ถูกต้องได้ในรอบนี้ กรุณาลองใหม่",
  INVALID_RESPONSE:
    "ผลลัพธ์จาก Local AI ไม่อยู่ในรูปแบบที่ระบบรองรับ กรุณาลองใหม่",
  SYSTEM: "เกิดข้อผิดพลาดในระบบ กรุณาลองใหม่ภายหลัง",
} as const;

export function describeLocalAiAvailability(
  availability: LocalAiAvailability,
): string | null {
  switch (availability) {
    case "enabled":
      return null;
    case "disabled":
      return `${LOCAL_AI_FAILURE_MESSAGES.DISABLED} ใช้งานได้เมื่อเปิดระบบบนเครื่องที่ติดตั้ง Ollama`;
    case "misconfigured":
      return LOCAL_AI_FAILURE_MESSAGES.MISCONFIGURED;
  }
}

export type LocalAiFailure = {
  message: string;
  // true only for 401: the card offers a link to sign in again.
  signIn: boolean;
};

/**
 * Maps an HTTP status (null = the request itself failed) to a fixed
 * message. The response body is intentionally not an input.
 */
export function describeLocalAiFailure(
  status: number | null,
): LocalAiFailure {
  const failure = (message: string, signIn = false): LocalAiFailure => ({
    message,
    signIn,
  });

  switch (status) {
    case null:
      return failure(LOCAL_AI_FAILURE_MESSAGES.NETWORK);
    case 401:
      return failure(LOCAL_AI_FAILURE_MESSAGES.UNAUTHENTICATED, true);
    case 403:
      return failure(LOCAL_AI_FAILURE_MESSAGES.FORBIDDEN);
    case 404:
      return failure(LOCAL_AI_FAILURE_MESSAGES.DISABLED);
    case 429:
      return failure(LOCAL_AI_FAILURE_MESSAGES.BUSY);
    case 502:
      return failure(LOCAL_AI_FAILURE_MESSAGES.LOCAL_AI_FAILED);
    case 503:
      return failure(LOCAL_AI_FAILURE_MESSAGES.UNREACHABLE);
    case 504:
      return failure(LOCAL_AI_FAILURE_MESSAGES.TIMEOUT);
    default:
      return failure(LOCAL_AI_FAILURE_MESSAGES.SYSTEM);
  }
}

export function invalidLocalAiResponseFailure(): LocalAiFailure {
  return {
    message: LOCAL_AI_FAILURE_MESSAGES.INVALID_RESPONSE,
    signIn: false,
  };
}

// ============================================================
// Labels
// ============================================================

export const LOCAL_AI_SIGNAL_LABELS: Record<LocalAiSignal, string> = {
  OUT_OF_STOCK: "หมด Stock",
  LOW_STOCK: "ใกล้หมด",
  BELOW_MINIMUM: "ต่ำกว่าขั้นต่ำ",
  WASTE: "มีของเสีย",
  ADJUSTMENT: "มีการปรับยอด",
};

export const LOCAL_AI_STOCK_STATUS_LABELS: Record<StockStatus, string> = {
  NORMAL: "ปกติ",
  LOW_STOCK: "ใกล้หมด",
  OUT_OF_STOCK: "หมด",
};

export const LOCAL_AI_EMPTY_TEXT = {
  OVERVIEW: "Local AI ไม่ได้สรุปภาพรวมในรอบนี้",
  ATTENTION: "Local AI ไม่ได้ระบุสินค้าที่ต้องสนใจเป็นพิเศษในรอบนี้",
  ACTIONS: "ยังไม่มีคำแนะนำเพิ่มเติมจากการวิเคราะห์รอบนี้",
  ITEM_FACTS: "ไม่พบข้อมูลจากระบบสำหรับรายการนี้",
} as const;

export function describeServerDataLimit(
  limit: ServerDataLimit,
  facts: LocalAiUiFacts,
): string {
  switch (limit) {
    case "DATA_INCOMPLETE":
      return "อ่านข้อมูลจากระบบได้ไม่ครบทุกส่วน ผลวิเคราะห์อาจไม่สมบูรณ์";
    case "ITEMS_OMITTED": {
      const omitted = facts.data_quality.omitted_count;

      return omitted > 0
        ? `มีสินค้าที่ควรตรวจสอบอีก ${formatCount(omitted)} รายการที่ไม่ได้รวมในการวิเคราะห์รอบนี้`
        : "มีสินค้าที่ควรตรวจสอบบางรายการที่ไม่ได้รวมในการวิเคราะห์รอบนี้";
    }
    case "STOCK_STATUS_INCONSISTENT":
      return "สถานะ Stock บางรายการไม่สอดคล้องกับจำนวนคงเหลือ";
    case "USAGE_RATE_UNAVAILABLE":
      return "ยังไม่มีข้อมูลอัตราการใช้สินค้าเพียงพอ";
    case "FORECAST_UNAVAILABLE":
      return "ยังไม่สามารถคาดการณ์วันที่ Stock จะหมดได้";
  }
}

// ============================================================
// Numbers (facts only)
// ============================================================

const QUANTITY_DECIMALS = 4;
const QUANTITY_SCALE = 10 ** QUANTITY_DECIMALS;

// Rounds to the display precision and removes binary noise and -0, so
// 0.3 - 0.1 shows as 0.2 and a zero difference is exactly 0.
export function roundQuantity(value: number): number {
  const rounded = Math.round(value * QUANTITY_SCALE) / QUANTITY_SCALE;

  return rounded === 0 ? 0 : rounded;
}

function formatNumber(value: number): string {
  return roundQuantity(value).toLocaleString("th-TH", {
    maximumFractionDigits: QUANTITY_DECIMALS,
  });
}

function formatCount(value: number): string {
  return value.toLocaleString("th-TH");
}

export function formatQuantity(
  value: number,
  unitSymbol: string,
): string {
  const text = formatNumber(value);

  return unitSymbol ? `${text} ${unitSymbol}` : text;
}

export function formatSignedQuantity(
  value: number,
  unitSymbol: string,
): string {
  const text = formatQuantity(value, unitSymbol);

  return roundQuantity(value) > 0 ? `+${text}` : text;
}

export type ReorderPosition = {
  relation: "above" | "equal" | "below";
  text: string;
};

/**
 * Position of current stock relative to the reorder point, computed from
 * facts only.
 */
export function describeReorderPosition(
  item: LocalAiUiFactItem,
): ReorderPosition {
  const difference = roundQuantity(
    item.current_quantity - item.reorder_point,
  );

  if (difference > 0) {
    return {
      relation: "above",
      text: `สูงกว่าจุดสั่งซื้อ ${formatQuantity(difference, item.unit.symbol)}`,
    };
  }

  if (difference < 0) {
    return {
      relation: "below",
      text: `ต่ำกว่าจุดสั่งซื้อ ${formatQuantity(-difference, item.unit.symbol)}`,
    };
  }

  return { relation: "equal", text: "เท่ากับจุดสั่งซื้อ" };
}

export function describeOpenPurchaseOrder(
  item: LocalAiUiFactItem,
): string | null {
  if (item.open_po_remaining_quantity <= 0) {
    return null;
  }

  const quantity = formatQuantity(
    item.open_po_remaining_quantity,
    item.unit.symbol,
  );

  if (!item.reorder_required) {
    return `มี PO ค้างรับ ${quantity}`;
  }

  return item.reorder_covered_by_open_po
    ? `มี PO ค้างรับ ${quantity} เมื่อรับครบจะสูงกว่าจุดสั่งซื้อ`
    : `มี PO ค้างรับ ${quantity} แต่ยังไม่พอให้สูงกว่าจุดสั่งซื้อ`;
}

export type LocalAiFactRow = {
  label: string;
  value: string;
};

export function buildFactRows(
  item: LocalAiUiFactItem,
  windowDays: number,
): LocalAiFactRow[] {
  const unit = item.unit.symbol;

  const rows: LocalAiFactRow[] = [
    {
      label: "สถานะ",
      value: LOCAL_AI_STOCK_STATUS_LABELS[item.stock_status],
    },
    {
      label: "คงเหลือ",
      value: formatQuantity(item.current_quantity, unit),
    },
    {
      label: "จุดสั่งซื้อ",
      value: formatQuantity(item.reorder_point, unit),
    },
    {
      label: "ขั้นต่ำ",
      value: formatQuantity(item.minimum_stock, unit),
    },
    {
      label: `ของเสีย ${windowDays} วัน`,
      value: formatQuantity(item.waste_7d, unit),
    },
  ];

  if (roundQuantity(item.adjustment_7d) !== 0) {
    rows.push({
      label: `ปรับยอด ${windowDays} วัน`,
      value: formatSignedQuantity(item.adjustment_7d, unit),
    });
  }

  return rows;
}

// ============================================================
// Model output joined with facts
// ============================================================

export type LocalAiAttentionRow = {
  key: string;
  sku: string;
  // From facts; falls back to the SKU when facts have no such item.
  name: string;
  signal: LocalAiSignal;
  signalLabel: string;
  // Validated model text, displayed verbatim and never parsed.
  note: string;
  item: LocalAiUiFactItem | null;
};

export function buildAttentionRows(
  summary: LocalAiSummaryResponse,
): LocalAiAttentionRow[] {
  const itemsBySku = new Map<string, LocalAiUiFactItem>();

  for (const item of summary.facts.items) {
    if (!itemsBySku.has(item.sku)) {
      itemsBySku.set(item.sku, item);
    }
  }

  return summary.result.attention.map((entry, index) => {
    const item = itemsBySku.get(entry.sku) ?? null;

    return {
      key: `${entry.sku}:${index}`,
      sku: entry.sku,
      name: item?.name ?? entry.sku,
      signal: entry.signal,
      signalLabel: LOCAL_AI_SIGNAL_LABELS[entry.signal],
      note: entry.note,
      item,
    };
  });
}

/** Facts items the model did not list in attention, in facts order. */
export function otherFactItems(
  summary: LocalAiSummaryResponse,
): LocalAiUiFactItem[] {
  const attentionSkus = new Set(
    summary.result.attention.map((entry) => entry.sku),
  );

  return summary.facts.items.filter(
    (item) => !attentionSkus.has(item.sku),
  );
}

// ============================================================
// Footer
// ============================================================

export function formatGeneratedAt(value: string): string | null {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toLocaleString("th-TH", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Bangkok",
  });
}

export function buildLocalAiFooter(
  meta: LocalAiSummaryResponse["meta"],
): string {
  const parts = ["Local AI"];
  const model = meta.model.trim();

  if (model) {
    parts.push(model);
  }

  parts.push("ประมวลผลบนเครื่อง");

  const time = formatGeneratedAt(meta.generated_at);

  if (time) {
    parts.push(time);
  }

  return parts.join(" · ");
}
