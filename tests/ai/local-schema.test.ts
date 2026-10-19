import { describe, expect, it } from "vitest";

import { LOCAL_AI_SIGNALS } from "@/lib/ai/local/digest";

import {
  LOCAL_AI_OUTPUT_LIMITS,
  localAiOutputJsonSchema,
  localAiOutputSchema,
} from "@/lib/ai/local/schema";

// Compact output contract (Phase 3.1): overview, at most 2 attention
// entries, at most 2 actions. No model-written data_limits.

function validOutput() {
  return {
    overview: "มีรายการใกล้หมดและของเสียที่ควรตรวจสอบ",
    attention: [
      {
        sku: "CHICKEN-BREAST",
        signal: "LOW_STOCK",
        note: "ตรวจสอบการเติมสต็อก",
      },
      {
        sku: "CHICKEN-BREAST",
        signal: "WASTE",
        note: "ตรวจสอบสาเหตุของของเสีย",
      },
    ],
    actions: [
      "ตรวจสอบใบสั่งซื้อที่เปิดอยู่",
      "ทบทวนการจัดเก็บวัตถุดิบ",
    ],
  };
}

function parse(value: unknown) {
  return localAiOutputSchema.safeParse(value);
}

const tooLong = (max: number) => "ก".repeat(max + 1);

describe("Local AI output schema (compact contract)", () => {
  it("uses the compact limits", () => {
    expect(LOCAL_AI_OUTPUT_LIMITS).toEqual({
      overviewMaxChars: 120,
      attentionMaxItems: 2,
      noteMaxChars: 80,
      actionsMaxItems: 2,
      actionMaxChars: 80,
      skuMaxChars: 48,
    });
  });

  it("1/22. accepts overview + 2 attention entries + 2 actions", () => {
    expect(parse(validOutput()).success).toBe(true);
  });

  it("accepts empty attention and actions", () => {
    expect(
      parse({
        ...validOutput(),
        attention: [],
        actions: [],
      }).success,
    ).toBe(true);
  });

  it("23. rejects an unknown signal", () => {
    const output = validOutput();

    output.attention[0].signal = "EXPIRING_SOON";

    expect(parse(output).success).toBe(false);
  });

  it("2/24. rejects 3 attention entries", () => {
    const output = validOutput();

    output.attention = [
      ...output.attention,
      { ...output.attention[0] },
    ];

    expect(parse(output).success).toBe(false);
  });

  it("3/25. rejects 3 actions", () => {
    expect(
      parse({
        ...validOutput(),
        actions: ["ก", "ข", "ค"],
      }).success,
    ).toBe(false);
  });

  it("4. rejects an overview longer than 120 characters", () => {
    expect(
      parse({
        ...validOutput(),
        overview: tooLong(
          LOCAL_AI_OUTPUT_LIMITS.overviewMaxChars,
        ),
      }).success,
    ).toBe(false);

    expect(
      parse({
        ...validOutput(),
        overview: "ก".repeat(
          LOCAL_AI_OUTPUT_LIMITS.overviewMaxChars,
        ),
      }).success,
    ).toBe(true);
  });

  it("5. rejects a note longer than 80 characters", () => {
    const output = validOutput();

    output.attention[0].note = tooLong(
      LOCAL_AI_OUTPUT_LIMITS.noteMaxChars,
    );

    expect(parse(output).success).toBe(false);

    output.attention[0].note = "ก".repeat(
      LOCAL_AI_OUTPUT_LIMITS.noteMaxChars,
    );

    expect(parse(output).success).toBe(true);
  });

  it("6. rejects an action longer than 80 characters", () => {
    expect(
      parse({
        ...validOutput(),
        actions: [
          tooLong(LOCAL_AI_OUTPUT_LIMITS.actionMaxChars),
        ],
      }).success,
    ).toBe(false);

    expect(
      parse({
        ...validOutput(),
        actions: [
          "ก".repeat(LOCAL_AI_OUTPUT_LIMITS.actionMaxChars),
        ],
      }).success,
    ).toBe(true);
  });

  it("rejects empty text", () => {
    expect(
      parse({ ...validOutput(), overview: "" }).success,
    ).toBe(false);
    expect(
      parse({ ...validOutput(), actions: [""] }).success,
    ).toBe(false);
  });

  it("7. rejects model-written data_limits as an extra key", () => {
    expect(
      parse({
        ...validOutput(),
        data_limits: ["ยังไม่มีข้อมูลอัตราการใช้"],
      }).success,
    ).toBe(false);

    expect(
      parse({ ...validOutput(), data_limits: [] }).success,
    ).toBe(false);
  });

  it("26. rejects numeric or extra fields, so the model cannot return quantities or decisions", () => {
    const withQuantity = validOutput() as Record<
      string,
      unknown
    >;

    (
      withQuantity.attention as Record<string, unknown>[]
    )[0].current_quantity = 6500;

    expect(parse(withQuantity).success).toBe(false);

    expect(
      parse({ ...validOutput(), reorder_required: false })
        .success,
    ).toBe(false);

    expect(
      parse({ ...validOutput(), data_complete: true })
        .success,
    ).toBe(false);
  });

  it("rejects missing keys and non-string text", () => {
    const missing: Record<string, unknown> = validOutput();

    delete missing.actions;

    expect(parse(missing).success).toBe(false);
    expect(
      parse({ ...validOutput(), actions: [42] }).success,
    ).toBe(false);
  });
});

describe("Local AI output JSON Schema", () => {
  it("27. is generated from the Zod schema and stable", () => {
    expect(localAiOutputJsonSchema).toEqual({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      properties: {
        overview: {
          type: "string",
          minLength: 1,
          maxLength: 120,
        },
        attention: {
          type: "array",
          maxItems: 2,
          items: {
            type: "object",
            properties: {
              sku: {
                type: "string",
                minLength: 1,
                maxLength: 48,
              },
              signal: {
                type: "string",
                enum: [
                  "OUT_OF_STOCK",
                  "LOW_STOCK",
                  "BELOW_MINIMUM",
                  "WASTE",
                  "ADJUSTMENT",
                ],
              },
              note: {
                type: "string",
                minLength: 1,
                maxLength: 80,
              },
            },
            required: ["sku", "signal", "note"],
            additionalProperties: false,
          },
        },
        actions: {
          type: "array",
          maxItems: 2,
          items: {
            type: "string",
            minLength: 1,
            maxLength: 80,
          },
        },
      },
      required: ["overview", "attention", "actions"],
      additionalProperties: false,
    });
  });

  it("represents the same signal enum and limits as the Zod schema", () => {
    const schema = localAiOutputJsonSchema as {
      properties: Record<
        string,
        {
          maxItems?: number;
          maxLength?: number;
          items?: {
            maxLength?: number;
            properties?: Record<
              string,
              { enum?: string[]; maxLength?: number }
            >;
          };
        }
      >;
    };

    const attention = schema.properties.attention;

    expect(
      attention.items?.properties?.signal.enum,
    ).toEqual([...LOCAL_AI_SIGNALS]);
    expect(attention.maxItems).toBe(
      LOCAL_AI_OUTPUT_LIMITS.attentionMaxItems,
    );
    expect(attention.items?.properties?.note.maxLength).toBe(
      LOCAL_AI_OUTPUT_LIMITS.noteMaxChars,
    );
    expect(schema.properties.overview.maxLength).toBe(
      LOCAL_AI_OUTPUT_LIMITS.overviewMaxChars,
    );
    expect(schema.properties.actions.maxItems).toBe(
      LOCAL_AI_OUTPUT_LIMITS.actionsMaxItems,
    );
    expect(schema.properties.actions.items?.maxLength).toBe(
      LOCAL_AI_OUTPUT_LIMITS.actionMaxChars,
    );
    expect(Object.keys(schema.properties)).not.toContain(
      "data_limits",
    );
  });

  it("26. contains no numeric types and no request-specific patterns", () => {
    const json = JSON.stringify(localAiOutputJsonSchema);

    expect(json).not.toMatch(/"type":"(number|integer)"/);
    expect(json).not.toContain('"pattern"');
  });
});
