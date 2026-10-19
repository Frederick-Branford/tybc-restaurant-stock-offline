import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import {
  FilePlus2,
  ShoppingCart,
} from "lucide-react";

import { EmptyState } from "@/components/app/empty-state";
import { Notice } from "@/components/app/notice";
import {
  PageHeader,
  Panel,
} from "@/components/app/page-header";
import { PurchaseOrderStatus } from "@/components/app/po-status";
import {
  RecordItem,
  RecordList,
} from "@/components/app/record-list";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/ui/format";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "ใบสั่งซื้อ",
};

type PurchaseOrdersPageProps = {
  searchParams: Promise<{
    error?: string;
  }>;
};

function Loading() {
  return (
    <div className="space-y-6" aria-busy="true">
      <Skeleton className="h-12 w-48" />
      <Skeleton className="h-72 w-full" />
    </div>
  );
}

export default function PurchaseOrdersPage(
  props: PurchaseOrdersPageProps,
) {
  return (
    <Suspense fallback={<Loading />}>
      <PurchaseOrdersContent
        {...props}
      />
    </Suspense>
  );
}

async function PurchaseOrdersContent({
  searchParams,
}: PurchaseOrdersPageProps) {
  await connection();

  const params =
    await searchParams;

  const supabase =
    await createClient();

  const {
    data: orders,
    error,
  } = await supabase
    .from("purchase_orders")
    .select(
      "id, po_number, supplier_id, status, expected_at, created_at",
    )
    .order(
      "created_at",
      {
        ascending: false,
      },
    );

  if (error) {
    throw new Error(
      `Unable to load purchase orders: ${error.message}`,
    );
  }

  const supplierIds = [
    ...new Set(
      (orders ?? []).map(
        (order) =>
          order.supplier_id,
      ),
    ),
  ];

  const {
    data: suppliers,
  } =
    supplierIds.length > 0
      ? await supabase
          .from("suppliers")
          .select("id, name")
          .in("id", supplierIds)
      : {
          data: [],
        };

  const supplierMap =
    new Map(
      (suppliers ?? []).map(
        (supplier) => [
          supplier.id,
          supplier.name,
        ],
      ),
    );

  return (
    <div className="space-y-6">
      <PageHeader
        icon={ShoppingCart}
        title="ใบสั่งซื้อ"
        description="Purchase Order สำหรับจัดซื้อวัตถุดิบและรับสินค้าเข้าคลัง"
        actions={
          <Link
            href="/purchase-orders/new"
            className={cn(buttonVariants(), "w-full sm:w-auto")}
          >
            <FilePlus2 className="size-4" aria-hidden="true" />
            สร้างใบสั่งซื้อ
          </Link>
        }
      />

      {params.error ? (
        <Notice tone="error">{params.error}</Notice>
      ) : null}

      <Panel aria-label="รายการใบสั่งซื้อ">
        {(orders ?? []).length === 0 ? (
          <EmptyState
            icon={ShoppingCart}
            title="ยังไม่มีใบสั่งซื้อ"
            description="เริ่มสร้าง PO แรกของร้าน"
            action={
              <Link
                href="/purchase-orders/new"
                className={buttonVariants()}
              >
                <FilePlus2 className="size-4" aria-hidden="true" />
                สร้างใบสั่งซื้อ
              </Link>
            }
          />
        ) : (
          <RecordList label="รายการใบสั่งซื้อ">
            {(orders ?? []).map(
              (order) => (
                <RecordItem
                  key={order.id}
                  href={`/purchase-orders/${order.id}`}
                  title={order.po_number}
                  subtitle={
                    supplierMap.get(
                      order.supplier_id,
                    ) ??
                    "ไม่ทราบผู้จำหน่าย"
                  }
                  meta={
                    order.expected_at
                      ? `คาดว่าจะได้รับ ${formatDate(order.expected_at)}`
                      : undefined
                  }
                  aside={
                    <PurchaseOrderStatus
                      status={order.status}
                    />
                  }
                />
              ),
            )}
          </RecordList>
        )}
      </Panel>
    </div>
  );
}
