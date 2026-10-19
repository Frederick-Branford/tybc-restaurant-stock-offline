"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { requirePermission } from "@/lib/auth/require-permission";

const stockOutSchema = z.object({
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

export async function createStockOut(
  formData: FormData,
) {
  const result = stockOutSchema.safeParse({
    itemId: formData.get("itemId"),
    inputUnitId: formData.get("inputUnitId"),
    quantity: formData.get("quantity"),
    note: formData.get("note"),
  });

  if (!result.success) {
    redirect("/stock-out?error=invalid");
  }

  const {
    user,
    admin,
  } = await requirePermission(
    "inventory.stock_out",
  );

  const idempotencyKey =
    `stock-out:${randomUUID()}`;

  const { error } = await admin.rpc(
    "record_stock_out",
    {
      p_item_id:
        result.data.itemId,

      p_input_quantity:
        result.data.quantity,

      p_input_unit_id:
        result.data.inputUnitId,

      p_actor_id:
        user.id,

      p_idempotency_key:
        idempotencyKey,

      p_note:
        result.data.note || null,

      p_occurred_at:
        new Date().toISOString(),
    },
  );

  if (error) {
    if (
      error.code === "P0001" &&
      error.message.includes(
        "INSUFFICIENT_STOCK",
      )
    ) {
      redirect(
        "/stock-out?error=insufficient",
      );
    }

    throw new Error(
      `Unable to record Stock Out: ${error.message}`,
    );
  }

  revalidatePath("/stock-out");
  revalidatePath("/inventory");
  revalidatePath("/dashboard");
  revalidatePath("/movements");

  redirect("/stock-out?created=1");
}
