"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { requirePermission } from "@/lib/auth/require-permission";

export async function createStockCount(
  formData: FormData,
) {
  const notesValue = formData.get("notes");

  const notes =
    typeof notesValue === "string"
      ? notesValue.trim().slice(0, 500)
      : "";

  const {
    user,
    admin,
  } = await requirePermission(
    "inventory.count",
  );

  const {
    data: countId,
    error,
  } = await admin.rpc(
    "create_stock_count",
    {
      p_actor_id: user.id,
      p_notes: notes || null,
    },
  );

  if (error || !countId) {
    throw new Error(
      `Unable to create Stock Count: ${
        error?.message ?? "Unknown error"
      }`,
    );
  }

  redirect(
    `/stock-count/${countId}`,
  );
}


const countItemSchema = z.object({
  stockCountId: z.string().uuid(),
  itemId: z.string().uuid(),
  inputUnitId: z.string().uuid(),

  quantity: z.coerce
    .number()
    .min(0)
    .finite(),
});

export async function recordCountItem(
  formData: FormData,
) {
  const result =
    countItemSchema.safeParse({
      stockCountId:
        formData.get("stockCountId"),

      itemId:
        formData.get("itemId"),

      inputUnitId:
        formData.get("inputUnitId"),

      quantity:
        formData.get("quantity"),
    });

  if (!result.success) {
    redirect(
      "/stock-count?error=invalid",
    );
  }

  const {
    user,
    admin,
  } = await requirePermission(
    "inventory.count",
  );

  const { error } = await admin.rpc(
    "record_stock_count_item",
    {
      p_stock_count_id:
        result.data.stockCountId,

      p_item_id:
        result.data.itemId,

      p_input_quantity:
        result.data.quantity,

      p_input_unit_id:
        result.data.inputUnitId,

      p_actor_id:
        user.id,
    },
  );

  if (error) {
    throw new Error(
      `Unable to record physical count: ${error.message}`,
    );
  }

  revalidatePath(
    `/stock-count/${result.data.stockCountId}`,
  );

  redirect(
    `/stock-count/${result.data.stockCountId}?saved=1`,
  );
}


export async function completeStockCount(
  formData: FormData,
) {
  const countIdValue =
    formData.get("stockCountId");

  const parsed =
    z.string().uuid().safeParse(
      countIdValue,
    );

  if (!parsed.success) {
    redirect(
      "/stock-count?error=invalid",
    );
  }

  const {
    user,
    admin,
  } = await requirePermission(
    "inventory.count",
  );

  const { error } = await admin.rpc(
    "complete_stock_count",
    {
      p_stock_count_id:
        parsed.data,

      p_actor_id:
        user.id,
    },
  );

  if (error) {
    if (
      error.message.includes(
        "Every item must be physically counted",
      )
    ) {
      redirect(
        `/stock-count/${parsed.data}?error=incomplete`,
      );
    }

    if (
      error.message.includes(
        "Stock changed after counting item",
      )
    ) {
      redirect(
        `/stock-count/${parsed.data}?error=stale`,
      );
    }

    throw new Error(
      `Unable to complete Stock Count: ${error.message}`,
    );
  }

  revalidatePath("/stock-count");
  revalidatePath("/inventory");
  revalidatePath("/dashboard");
  revalidatePath("/movements");

  redirect(
    `/stock-count/${parsed.data}?completed=1`,
  );
}
