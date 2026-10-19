"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const supplierSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "กรุณากรอกชื่อผู้จำหน่าย")
    .max(160),

  contactName: z
    .string()
    .trim()
    .max(160)
    .optional(),

  phone: z
    .string()
    .trim()
    .max(50)
    .optional(),

  email: z
    .string()
    .trim()
    .max(160)
    .optional(),

  taxId: z
    .string()
    .trim()
    .max(50)
    .optional(),

  address: z
    .string()
    .trim()
    .max(1000)
    .optional(),

  note: z
    .string()
    .trim()
    .max(1000)
    .optional(),
});

function optionalText(value: FormDataEntryValue | null) {
  const text = String(value ?? "").trim();
  return text.length > 0 ? text : undefined;
}

async function requireSupplierManager() {
  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    redirect("/login");
  }

  const admin = createAdminClient();

  const { data: allowed, error } =
    await admin.rpc(
      "user_has_permission",
      {
        p_user_id: user.id,
        requested_permission:
          "supplier.manage",
      },
    );

  if (error) {
    throw new Error(
      `Permission check failed: ${error.message}`,
    );
  }

  if (!allowed) {
    redirect(
      "/suppliers?error=" +
        encodeURIComponent(
          "คุณไม่มีสิทธิ์จัดการผู้จำหน่าย",
        ),
    );
  }

  return {
    user,
    admin,
  };
}

export async function createSupplier(
  formData: FormData,
) {
  const parsed =
    supplierSchema.safeParse({
      name: String(
        formData.get("name") ?? "",
      ),

      contactName: optionalText(
        formData.get("contact_name"),
      ),

      phone: optionalText(
        formData.get("phone"),
      ),

      email: optionalText(
        formData.get("email"),
      ),

      taxId: optionalText(
        formData.get("tax_id"),
      ),

      address: optionalText(
        formData.get("address"),
      ),

      note: optionalText(
        formData.get("note"),
      ),
    });

  if (!parsed.success) {
    const message =
      parsed.error.issues[0]?.message ??
      "ข้อมูลผู้จำหน่ายไม่ถูกต้อง";

    redirect(
      "/suppliers?error=" +
        encodeURIComponent(message),
    );
  }

  const { user, admin } =
    await requireSupplierManager();

  const { error } = await admin
    .from("suppliers")
    .insert({
      name: parsed.data.name,

      contact_name:
        parsed.data.contactName ?? null,

      phone:
        parsed.data.phone ?? null,

      email:
        parsed.data.email ?? null,

      tax_id:
        parsed.data.taxId ?? null,

      address:
        parsed.data.address ?? null,

      note:
        parsed.data.note ?? null,

      created_by: user.id,
    });

  if (error) {
    redirect(
      "/suppliers?error=" +
        encodeURIComponent(error.message),
    );
  }

  revalidatePath("/suppliers");

  redirect(
    "/suppliers?success=" +
      encodeURIComponent(
        "เพิ่มผู้จำหน่ายเรียบร้อยแล้ว",
      ),
  );
}

const supplierStatusSchema = z.object({
  supplierId: z.string().uuid(),
  nextActive: z.enum(["true", "false"]),
});

export async function setSupplierActive(
  formData: FormData,
) {
  const parsed =
    supplierStatusSchema.safeParse({
      supplierId: String(
        formData.get("supplier_id") ?? "",
      ),

      nextActive: String(
        formData.get("next_active") ?? "",
      ),
    });

  if (!parsed.success) {
    redirect(
      "/suppliers?error=" +
        encodeURIComponent(
          "ข้อมูลผู้จำหน่ายไม่ถูกต้อง",
        ),
    );
  }

  const { admin } =
    await requireSupplierManager();

  const nextActive =
    parsed.data.nextActive === "true";

  const { error } = await admin
    .from("suppliers")
    .update({
      is_active: nextActive,
    })
    .eq(
      "id",
      parsed.data.supplierId,
    );

  if (error) {
    redirect(
      "/suppliers?error=" +
        encodeURIComponent(error.message),
    );
  }

  revalidatePath("/suppliers");

  redirect(
    "/suppliers?success=" +
      encodeURIComponent(
        nextActive
          ? "เปิดใช้งานผู้จำหน่ายแล้ว"
          : "ปิดใช้งานผู้จำหน่ายแล้ว",
      ),
  );
}