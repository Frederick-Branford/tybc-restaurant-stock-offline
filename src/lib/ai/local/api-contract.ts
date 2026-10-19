// Local AI HTTP contract: the exact JSON shapes of
// POST /api/ai/local/summary, shared by the route and (later) the UI.
//
// Pure module: no server-only, no Supabase, no environment.
//
// The response deliberately separates:
// - result: model text that passed Zod + semantic validation, and the
//   server-owned data limits;
// - facts: authoritative numbers from Business Snapshot V2 for the digest
//   items, which the UI joins to result.attention[].sku;
// - meta: server/runtime metadata, never from the model.

import { z } from "zod";

import { LOCAL_AI_SIGNALS } from "@/lib/ai/local/digest";
import { SERVER_DATA_LIMITS } from "@/lib/ai/local/validate";
import {
  MOVEMENT_WINDOW_DAYS,
  STOCK_STATUSES,
} from "@/lib/ai/snapshot/facts";

// ============================================================
// UI-safe facts
// ============================================================

export const localAiUiFactItemSchema = z.object({
  sku: z.string(),
  name: z.string(),
  unit: z.object({
    code: z.string(),
    symbol: z.string(),
  }),
  stock_status: z.enum(STOCK_STATUSES),
  current_quantity: z.number(),
  reorder_point: z.number(),
  minimum_stock: z.number(),
  reorder_required: z.boolean(),
  reorder_covered_by_open_po: z.boolean(),
  waste_7d: z.number(),
  adjustment_7d: z.number(),
  open_po_remaining_quantity: z.number(),
});

export const localAiUiFactsSchema = z.object({
  movement_window_days: z.literal(MOVEMENT_WINDOW_DAYS),
  items: z.array(localAiUiFactItemSchema),
  data_quality: z.object({
    // Every Snapshot V2 dataset read was proven complete and no rows were
    // excluded. This is NOT a single point-in-time transaction.
    complete: z.boolean(),
    stock_status_consistent: z.boolean(),
    omitted_count: z.number().int().nonnegative(),
  }),
});

export type LocalAiUiFactItem = z.infer<
  typeof localAiUiFactItemSchema
>;

export type LocalAiUiFacts = z.infer<
  typeof localAiUiFactsSchema
>;

// ============================================================
// Responses
// ============================================================

export const localAiSummaryResponseSchema = z.object({
  result: z.object({
    overview: z.string().nullable(),
    attention: z.array(
      z.object({
        sku: z.string(),
        signal: z.enum(LOCAL_AI_SIGNALS),
        note: z.string(),
      }),
    ),
    actions: z.array(z.string()),
    server_data_limits: z.array(z.enum(SERVER_DATA_LIMITS)),
  }),
  facts: localAiUiFactsSchema,
  meta: z.object({
    provider: z.literal("ollama"),
    model: z.string(),
    generated_at: z.string(),
    duration_ms: z.number().int().nonnegative(),
  }),
});

export type LocalAiSummaryResponse = z.infer<
  typeof localAiSummaryResponseSchema
>;

export const LOCAL_AI_ROUTE_ERROR_CODES = [
  "LOCAL_AI_DISABLED",
  "LOCAL_AI_CONFIGURATION_ERROR",
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "AUTH_CHECK_FAILED",
  "PERMISSION_CHECK_FAILED",
  "LOCAL_AI_BUSY",
  "SNAPSHOT_FAILED",
  "OLLAMA_UNREACHABLE",
  "OLLAMA_TIMEOUT",
  "OLLAMA_REQUEST_FAILED",
  "INVALID_MODEL_OUTPUT",
  "INTERNAL_ERROR",
] as const;

export type LocalAiRouteErrorCode =
  (typeof LOCAL_AI_ROUTE_ERROR_CODES)[number];

export const localAiErrorResponseSchema = z.object({
  code: z.enum(LOCAL_AI_ROUTE_ERROR_CODES),
  error: z.string(),
});

export type LocalAiErrorResponse = z.infer<
  typeof localAiErrorResponseSchema
>;

// HTTP status and short user-safe Thai message per error code. Auth codes
// come from checkApiPermission() with their own messages.
export const LOCAL_AI_ROUTE_ERRORS: Record<
  Exclude<
    LocalAiRouteErrorCode,
    | "UNAUTHENTICATED"
    | "FORBIDDEN"
    | "AUTH_CHECK_FAILED"
    | "PERMISSION_CHECK_FAILED"
  >,
  { status: number; error: string }
> = {
  LOCAL_AI_DISABLED: {
    status: 404,
    error: "Local AI ไม่ได้เปิดใช้งานบนเครื่องนี้",
  },
  LOCAL_AI_CONFIGURATION_ERROR: {
    status: 500,
    error: "การตั้งค่า Local AI ไม่ถูกต้อง",
  },
  LOCAL_AI_BUSY: {
    status: 429,
    error: "Local AI กำลังวิเคราะห์คำขออื่นอยู่ กรุณาลองใหม่อีกครั้ง",
  },
  SNAPSHOT_FAILED: {
    status: 500,
    error: "ไม่สามารถดึงข้อมูลสต็อกได้ในขณะนี้",
  },
  OLLAMA_UNREACHABLE: {
    status: 503,
    error: "ไม่สามารถเชื่อมต่อ Local AI ได้",
  },
  OLLAMA_TIMEOUT: {
    status: 504,
    error: "Local AI ใช้เวลานานเกินกำหนด กรุณาลองใหม่",
  },
  OLLAMA_REQUEST_FAILED: {
    status: 502,
    error: "Local AI ตอบกลับไม่สำเร็จ",
  },
  INVALID_MODEL_OUTPUT: {
    status: 502,
    error: "ผลลัพธ์จาก Local AI ไม่ผ่านการตรวจสอบ",
  },
  INTERNAL_ERROR: {
    status: 500,
    error: "เกิดข้อผิดพลาดภายในระบบ",
  },
};
