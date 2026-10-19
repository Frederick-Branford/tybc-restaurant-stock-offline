"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { requirePermission } from "@/lib/auth/require-permission";

const createItemSchema = z.object({
  sku: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .transform((value) => value.toUpperCase()),

  name: z
    .string()
    .trim()
    .min(1)
    .max(160),

  categoryId: z.string().uuid(),

  baseUnitId: z.string().uuid(),

  minimumStock: z.coerce
    .number()
    .min(0),

  reorderPoint: z.coerce
    .number()
    .min(0),
});

export async function createItem(
  formData: FormData,
) {
  const result = createItemSchema.safeParse({
    sku: formData.get("sku"),
    name: formData.get("name"),
    categoryId: formData.get("categoryId"),
    baseUnitId: formData.get("baseUnitId"),
    minimumStock: formData.get("minimumStock"),
    reorderPoint: formData.get("reorderPoint"),
  });

  if (!result.success) {
    redirect("/inventory?error=invalid");
  }

  if (
    result.data.reorderPoint <
    result.data.minimumStock
  ) {
    redirect("/inventory?error=reorder");
  }

  const { admin } =
    await requirePermission("inventory.create");

  const { error } = await admin
    .from("items")
    .insert({
      sku: result.data.sku,
      name: result.data.name,
      category_id: result.data.categoryId,
      base_unit_id: result.data.baseUnitId,
      minimum_stock: result.data.minimumStock,
      reorder_point: result.data.reorderPoint,
      is_active: true,
    });

  if (error) {
    if (error.code === "23505") {
      redirect("/inventory?error=duplicate");
    }

    throw new Error(
      `Unable to create inventory item: ${error.message}`,
    );
  }

  revalidatePath("/inventory");
  revalidatePath("/dashboard");

  redirect("/inventory?created=1");
}
