// Local AI structured output: the only shape the local model may return.
//
// One Zod schema is the source of truth. The JSON Schema sent to the model
// runtime (Ollama `format`, Phase 3) is generated from it, never written by
// hand.
//
// The schema has no numeric fields. Quantities, reorder decisions, PO
// coverage and data completeness stay server facts; the model only adds
// short explanatory text keyed by SKU + signal.
//
// Compact contract (Phase 3.1): a small dashboard insight, not a report.
// The model does not write data limitations; the server derives them
// (server_data_limits in validate.ts). The real CPU-only notebook needed
// ~310 output tokens for the previous, larger contract.
//
// Lengths are JavaScript string lengths (UTF-16 code units). Thai
// characters are single code units, but vowel and tone marks count
// separately, so 80 units is roughly 55-80 visible Thai characters.

import { z } from "zod";

import {
  LOCAL_DIGEST_MAX_SKU_LENGTH,
  localAiSignalSchema,
} from "@/lib/ai/local/digest";

export const LOCAL_AI_OUTPUT_LIMITS = {
  overviewMaxChars: 120,
  attentionMaxItems: 2,
  noteMaxChars: 80,
  actionsMaxItems: 2,
  actionMaxChars: 80,
  skuMaxChars: LOCAL_DIGEST_MAX_SKU_LENGTH,
} as const;

const limits = LOCAL_AI_OUTPUT_LIMITS;

export const localAiAttentionSchema = z.strictObject({
  sku: z.string().min(1).max(limits.skuMaxChars),
  signal: localAiSignalSchema,
  note: z.string().min(1).max(limits.noteMaxChars),
});

export const localAiOutputSchema = z.strictObject({
  overview: z.string().min(1).max(limits.overviewMaxChars),
  attention: z
    .array(localAiAttentionSchema)
    .max(limits.attentionMaxItems),
  actions: z
    .array(z.string().min(1).max(limits.actionMaxChars))
    .max(limits.actionsMaxItems),
});

export type LocalAiAttention = z.infer<
  typeof localAiAttentionSchema
>;

export type LocalAiOutput = z.infer<
  typeof localAiOutputSchema
>;

// Generated from the same Zod schema (Zod 4 native JSON Schema support).
export const localAiOutputJsonSchema = z.toJSONSchema(
  localAiOutputSchema,
);
