"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

function optionalText(
  value: FormDataEntryValue | null,
) {
  const text = String(value ?? "").trim();

  return text.length > 0
    ? text
    : undefined;
}

async function requirePermission(
  permission: string,
) {
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
          permission,
      },
    );

  if (error) {
    throw new Error(
      `Permission check failed: ${error.message}`,
    );
  }

  if (!allowed) {
    redirect(
      "/purchase-orders?error=" +
        encodeURIComponent(
          "คุณไม่มีสิทธิ์ดำเนินการนี้",
        ),
    );
  }

  return {
    user,
    admin,
  };
}

const createPurchaseOrderSchema =
  z.object({
    supplierId: z.string().uuid(),

    expectedDate:
      z.string().optional(),

    notes:
      z.string()
        .trim()
        .max(2000)
        .optional(),
  });

export async function createPurchaseOrder(
  formData: FormData,
) {
  const parsed =
    createPurchaseOrderSchema.safeParse({
      supplierId: String(
        formData.get(
          "supplier_id",
        ) ?? "",
      ),

      expectedDate: optionalText(
        formData.get(
          "expected_date",
        ),
      ),

      notes: optionalText(
        formData.get("notes"),
      ),
    });

  if (!parsed.success) {
    redirect(
      "/purchase-orders/new?error=" +
        encodeURIComponent(
          "ข้อมูลใบสั่งซื้อไม่ถูกต้อง",
        ),
    );
  }

  const { user, admin } =
    await requirePermission(
      "purchase.create",
    );

  const {
    data: supplier,
    error: supplierError,
  } = await admin
    .from("suppliers")
    .select("id, is_active")
    .eq(
      "id",
      parsed.data.supplierId,
    )
    .maybeSingle();

  if (
    supplierError ||
    !supplier ||
    !supplier.is_active
  ) {
    redirect(
      "/purchase-orders/new?error=" +
        encodeURIComponent(
          "ผู้จำหน่ายไม่พร้อมใช้งาน",
        ),
    );
  }

  const expectedAt =
    parsed.data.expectedDate
      ? `${parsed.data.expectedDate}T12:00:00+07:00`
      : null;

  const {
    data: purchaseOrder,
    error,
  } = await admin
    .from("purchase_orders")
    .insert({
      supplier_id:
        parsed.data.supplierId,

      expected_at:
        expectedAt,

      notes:
        parsed.data.notes ?? null,

      created_by:
        user.id,
    })
    .select("id")
    .single();

  if (error || !purchaseOrder) {
    redirect(
      "/purchase-orders/new?error=" +
        encodeURIComponent(
          error?.message ??
            "ไม่สามารถสร้างใบสั่งซื้อได้",
        ),
    );
  }

  redirect(
    `/purchase-orders/${purchaseOrder.id}?success=` +
      encodeURIComponent(
        "สร้างใบสั่งซื้อแบบร่างแล้ว",
      ),
  );
}

const addItemSchema =
  z.object({
    purchaseOrderId:
      z.string().uuid(),

    itemId:
      z.string().uuid(),

    unitId:
      z.string().uuid(),

    quantity:
      z.coerce.number().positive(),

    unitCost:
      z.union([
        z.coerce.number().min(0),
        z.literal(""),
      ]).optional(),
  });

export async function addPurchaseOrderItem(
  formData: FormData,
) {
  const parsed =
    addItemSchema.safeParse({
      purchaseOrderId:
        String(
          formData.get(
            "purchase_order_id",
          ) ?? "",
        ),

      itemId:
        String(
          formData.get(
            "item_id",
          ) ?? "",
        ),

      unitId:
        String(
          formData.get(
            "unit_id",
          ) ?? "",
        ),

      quantity:
        formData.get(
          "quantity",
        ),

      unitCost:
        String(
          formData.get(
            "unit_cost",
          ) ?? "",
        ),
    });

  const fallbackId =
    String(
      formData.get(
        "purchase_order_id",
      ) ?? "",
    );

  if (!parsed.success) {
    redirect(
      `/purchase-orders/${fallbackId}?error=` +
        encodeURIComponent(
          "ข้อมูลรายการสินค้าไม่ถูกต้อง",
        ),
    );
  }

  const { admin } =
    await requirePermission(
      "purchase.create",
    );

  const {
    data: purchaseOrder,
    error: poError,
  } = await admin
    .from("purchase_orders")
    .select("id, status")
    .eq(
      "id",
      parsed.data.purchaseOrderId,
    )
    .maybeSingle();

  if (
    poError ||
    !purchaseOrder
  ) {
    redirect(
      "/purchase-orders?error=" +
        encodeURIComponent(
          "ไม่พบใบสั่งซื้อ",
        ),
    );
  }

  if (
    purchaseOrder.status !==
    "DRAFT"
  ) {
    redirect(
      `/purchase-orders/${parsed.data.purchaseOrderId}?error=` +
        encodeURIComponent(
          "เพิ่มรายการได้เฉพาะใบสั่งซื้อที่เป็นแบบร่าง",
        ),
    );
  }

  const unitCost =
    parsed.data.unitCost === "" ||
    parsed.data.unitCost ===
      undefined
      ? null
      : parsed.data.unitCost;

  const { error } = await admin
    .from(
      "purchase_order_items",
    )
    .insert({
      purchase_order_id:
        parsed.data.purchaseOrderId,

      item_id:
        parsed.data.itemId,

      ordered_quantity:
        parsed.data.quantity,

      order_unit_id:
        parsed.data.unitId,

      unit_cost:
        unitCost,
    });

  if (error) {
    const message =
      error.code === "23505"
        ? "สินค้านี้อยู่ในใบสั่งซื้อแล้ว"
        : error.message;

    redirect(
      `/purchase-orders/${parsed.data.purchaseOrderId}?error=` +
        encodeURIComponent(
          message,
        ),
    );
  }

  revalidatePath(
    `/purchase-orders/${parsed.data.purchaseOrderId}`,
  );

  redirect(
    `/purchase-orders/${parsed.data.purchaseOrderId}?success=` +
      encodeURIComponent(
        "เพิ่มรายการสินค้าแล้ว",
      ),
  );
}

const poItemActionSchema =
  z.object({
    purchaseOrderId:
      z.string().uuid(),

    purchaseOrderItemId:
      z.string().uuid(),
  });

export async function deletePurchaseOrderItem(
  formData: FormData,
) {
  const parsed =
    poItemActionSchema.safeParse({
      purchaseOrderId:
        String(
          formData.get(
            "purchase_order_id",
          ) ?? "",
        ),

      purchaseOrderItemId:
        String(
          formData.get(
            "purchase_order_item_id",
          ) ?? "",
        ),
    });

  if (!parsed.success) {
    redirect(
      "/purchase-orders?error=" +
        encodeURIComponent(
          "ข้อมูลรายการไม่ถูกต้อง",
        ),
    );
  }

  const { admin } =
    await requirePermission(
      "purchase.create",
    );

  const { error } = await admin
    .from(
      "purchase_order_items",
    )
    .delete()
    .eq(
      "id",
      parsed.data
        .purchaseOrderItemId,
    );

  if (error) {
    redirect(
      `/purchase-orders/${parsed.data.purchaseOrderId}?error=` +
        encodeURIComponent(
          error.message,
        ),
    );
  }

  revalidatePath(
    `/purchase-orders/${parsed.data.purchaseOrderId}`,
  );

  redirect(
    `/purchase-orders/${parsed.data.purchaseOrderId}?success=` +
      encodeURIComponent(
        "ลบรายการสินค้าแล้ว",
      ),
  );
}

const poIdSchema = z.object({
  purchaseOrderId:
    z.string().uuid(),
});

export async function confirmPurchaseOrder(
  formData: FormData,
) {
  const parsed =
    poIdSchema.safeParse({
      purchaseOrderId:
        String(
          formData.get(
            "purchase_order_id",
          ) ?? "",
        ),
    });

  if (!parsed.success) {
    redirect(
      "/purchase-orders?error=" +
        encodeURIComponent(
          "ข้อมูลใบสั่งซื้อไม่ถูกต้อง",
        ),
    );
  }

  const { user, admin } =
    await requirePermission(
      "purchase.approve",
    );

  const { error } = await admin
    .from("purchase_orders")
    .update({
      status: "ORDERED",
      approved_by: user.id,
      approved_at:
        new Date().toISOString(),
    })
    .eq(
      "id",
      parsed.data.purchaseOrderId,
    )
    .eq(
      "status",
      "DRAFT",
    );

  if (error) {
    redirect(
      `/purchase-orders/${parsed.data.purchaseOrderId}?error=` +
        encodeURIComponent(
          error.message,
        ),
    );
  }

  revalidatePath(
    "/purchase-orders",
  );

  revalidatePath(
    `/purchase-orders/${parsed.data.purchaseOrderId}`,
  );

  redirect(
    `/purchase-orders/${parsed.data.purchaseOrderId}?success=` +
      encodeURIComponent(
        "ยืนยันใบสั่งซื้อแล้ว",
      ),
  );
}

export async function cancelPurchaseOrder(
  formData: FormData,
) {
  const parsed =
    poIdSchema.safeParse({
      purchaseOrderId:
        String(
          formData.get(
            "purchase_order_id",
          ) ?? "",
        ),
    });

  if (!parsed.success) {
    redirect(
      "/purchase-orders?error=" +
        encodeURIComponent(
          "ข้อมูลใบสั่งซื้อไม่ถูกต้อง",
        ),
    );
  }

  const { user, admin } =
    await requirePermission(
      "purchase.create",
    );

  const { error } = await admin
    .from("purchase_orders")
    .update({
      status:
        "CANCELLED",

      cancelled_by:
        user.id,

      cancelled_at:
        new Date().toISOString(),
    })
    .eq(
      "id",
      parsed.data.purchaseOrderId,
    )
    .in(
      "status",
      [
        "DRAFT",
        "ORDERED",
      ],
    );

  if (error) {
    redirect(
      `/purchase-orders/${parsed.data.purchaseOrderId}?error=` +
        encodeURIComponent(
          error.message,
        ),
    );
  }

  revalidatePath(
    "/purchase-orders",
  );

  revalidatePath(
    `/purchase-orders/${parsed.data.purchaseOrderId}`,
  );

  redirect(
    `/purchase-orders/${parsed.data.purchaseOrderId}?success=` +
      encodeURIComponent(
        "ยกเลิกใบสั่งซื้อแล้ว",
      ),
  );
}
const receivePurchaseOrderItemSchema =
  z.object({
    purchaseOrderItemId:
      z.string().uuid(),

    quantity:
      z.coerce.number().positive(),

    idempotencyKey:
      z.string().trim().min(8),

    note:
      z.string()
        .trim()
        .max(1000)
        .optional(),
  });

export async function receivePurchaseOrderItem(
  formData: FormData,
) {
  const parsed =
    receivePurchaseOrderItemSchema.safeParse({
      purchaseOrderItemId:
        String(
          formData.get(
            "purchase_order_item_id",
          ) ?? "",
        ),

      quantity:
        formData.get(
          "quantity",
        ),

      idempotencyKey:
        String(
          formData.get(
            "idempotency_key",
          ) ?? "",
        ),

      note:
        optionalText(
          formData.get("note"),
        ),
    });

  if (!parsed.success) {
    redirect(
      "/purchase-orders?error=" +
        encodeURIComponent(
          "ข้อมูลการรับสินค้าไม่ถูกต้อง",
        ),
    );
  }

  const { user, admin } =
    await requirePermission(
      "purchase.receive",
    );

  const {
    data: poItem,
    error: poItemError,
  } = await admin
    .from("purchase_order_items")
    .select(
      "id, purchase_order_id",
    )
    .eq(
      "id",
      parsed.data
        .purchaseOrderItemId,
    )
    .maybeSingle();

  if (
    poItemError ||
    !poItem
  ) {
    redirect(
      "/purchase-orders?error=" +
        encodeURIComponent(
          "ไม่พบรายการสินค้าในใบสั่งซื้อ",
        ),
    );
  }

  const {
    error,
  } = await admin.rpc(
    "receive_purchase_order_item",
    {
      p_purchase_order_item_id:
        parsed.data
          .purchaseOrderItemId,

      p_received_quantity:
        parsed.data.quantity,

      p_actor_id:
        user.id,

      p_idempotency_key:
        parsed.data
          .idempotencyKey,

      p_note:
        parsed.data.note ?? null,

      p_received_at:
        new Date().toISOString(),
    },
  );

  if (error) {
    redirect(
      `/purchase-orders/${poItem.purchase_order_id}?error=` +
        encodeURIComponent(
          error.message,
        ),
    );
  }

  revalidatePath(
    `/purchase-orders/${poItem.purchase_order_id}`,
  );

  revalidatePath(
    "/purchase-orders",
  );

  revalidatePath(
    "/inventory",
  );

  revalidatePath(
    "/dashboard",
  );

  revalidatePath(
    "/movements",
  );

  redirect(
    `/purchase-orders/${poItem.purchase_order_id}?success=` +
      encodeURIComponent(
        "รับสินค้าเข้าคลังเรียบร้อยแล้ว",
      ),
  );
}