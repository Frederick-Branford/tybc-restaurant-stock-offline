"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { requirePermission } from "@/lib/auth/require-permission";

const wasteSchema = z.object({
  itemId: z.string().uuid(),
  inputUnitId: z.string().uuid(),
  wasteReasonId: z.string().uuid(),

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

export async function createWaste(
  formData: FormData,
) {
  const result = wasteSchema.safeParse({
    itemId: formData.get("itemId"),
    inputUnitId: formData.get("inputUnitId"),
    wasteReasonId: formData.get("wasteReasonId"),
    quantity: formData.get("quantity"),
    note: formData.get("note"),
  });

  if (!result.success) {
    redirect("/waste?error=invalid");
  }

  const {
    user,
    admin,
  } = await requirePermission(
    "waste.create",
  );

  const { error } = await admin.rpc(
    "record_waste",
    {
      p_item_id:
        result.data.itemId,

      p_input_quantity:
        result.data.quantity,

      p_input_unit_id:
        result.data.inputUnitId,

      p_waste_reason_id:
        result.data.wasteReasonId,

      p_actor_id:
        user.id,

      p_idempotency_key:
        `waste:${randomUUID()}`,

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
        "/waste?error=insufficient",
      );
    }

    throw new Error(
      `Unable to record Waste: ${error.message}`,
    );
  }

  revalidatePath("/waste");
  revalidatePath("/inventory");
  revalidatePath("/dashboard");
  revalidatePath("/movements");

  redirect("/waste?created=1");
}
