"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { requirePermission } from "@/lib/auth/require-permission";

const stockInSchema = z.object({
  itemId: z.string().uuid(),
  inputUnitId: z.string().uuid(),

  quantity: z.coerce
    .number()
    .positive()
    .finite(),

  note: z
    .string()
    .trim()
    .max(500)
    .optional(),
});

export async function createStockIn(
  formData: FormData,
) {
  const result = stockInSchema.safeParse({
    itemId: formData.get("itemId"),
    inputUnitId: formData.get("inputUnitId"),
    quantity: formData.get("quantity"),
    note: formData.get("note"),
  });

  if (!result.success) {
    redirect("/stock-in?error=invalid");
  }

  const {
    user,
    admin,
  } = await requirePermission(
    "inventory.stock_in",
  );

  const { data: item, error: itemError } =
    await admin
      .from("items")
      .select("id, base_unit_id, is_active")
      .eq("id", result.data.itemId)
      .eq("is_active", true)
      .maybeSingle();

  if (itemError || !item) {
    redirect("/stock-in?error=item");
  }

  const {
    data: itemUnit,
    error: unitError,
  } = await admin
    .from("item_units")
    .select("conversion_to_base")
    .eq("item_id", result.data.itemId)
    .eq(
      "unit_id",
      result.data.inputUnitId,
    )
    .eq("is_active", true)
    .maybeSingle();

  if (
    unitError ||
    !itemUnit
  ) {
    redirect("/stock-in?error=unit");
  }

  const conversion =
    Number(itemUnit.conversion_to_base);

  const baseQuantity =
    Math.round(
      result.data.quantity *
        conversion *
        10000,
    ) / 10000;

  if (
    !Number.isFinite(baseQuantity) ||
    baseQuantity <= 0
  ) {
    redirect("/stock-in?error=quantity");
  }

  const idempotencyKey =
    `stock-in:${randomUUID()}`;

  const { error } = await admin
    .from("stock_movements")
    .insert({
      item_id: result.data.itemId,

      movement_type: "STOCK_IN",

      input_quantity:
        result.data.quantity,

      input_unit_id:
        result.data.inputUnitId,

      conversion_to_base:
        conversion,

      base_unit_id:
        item.base_unit_id,

      base_quantity:
        baseQuantity,

      reason_code:
        "MANUAL_STOCK_IN",

      note:
        result.data.note || null,

      idempotency_key:
        idempotencyKey,

      created_by:
        user.id,
    });

  if (error) {
    throw new Error(
      `Unable to record Stock In: ${error.message}`,
    );
  }

  revalidatePath("/stock-in");
  revalidatePath("/inventory");
  revalidatePath("/dashboard");
  revalidatePath("/movements");

  redirect("/stock-in?created=1");
}
