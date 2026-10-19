import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import {
  ArrowLeft,
  Building2,
  FilePlus2,
} from "lucide-react";

import { EmptyState } from "@/components/app/empty-state";
import {
  Field,
  MobileActionBar,
  NativeSelect,
} from "@/components/app/form-controls";
import { Notice } from "@/components/app/notice";
import {
  PageHeader,
  Panel,
  SectionHeader,
} from "@/components/app/page-header";
import { SubmitButton } from "@/components/app/submit-button";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { createClient } from "@/lib/supabase/server";

import {
  createPurchaseOrder,
} from "../actions";

export const metadata: Metadata = {
  title: "สร้างใบสั่งซื้อ",
};

type NewPurchaseOrderPageProps = {
  searchParams: Promise<{
    error?: string;
  }>;
};

function Loading() {
  return (
    <div className="mx-auto max-w-3xl space-y-6" aria-busy="true">
      <Skeleton className="h-12 w-56" />
      <Skeleton className="h-80 w-full" />
    </div>
  );
}

export default function NewPurchaseOrderPage(
  props: NewPurchaseOrderPageProps,
) {
  return (
    <Suspense fallback={<Loading />}>
      <NewPurchaseOrderContent
        {...props}
      />
    </Suspense>
  );
}

async function NewPurchaseOrderContent({
  searchParams,
}: NewPurchaseOrderPageProps) {
  await connection();

  const params =
    await searchParams;

  const supabase =
    await createClient();

  const {
    data: suppliers,
    error,
  } = await supabase
    .from("suppliers")
    .select("id, name")
    .eq("is_active", true)
    .order("name");

  if (error) {
    throw new Error(
      `Unable to load suppliers: ${error.message}`,
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        eyebrow={
          <Link
            href="/purchase-orders"
            className="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
            กลับไปใบสั่งซื้อ
          </Link>
        }
        icon={FilePlus2}
        title="สร้างใบสั่งซื้อ"
        description="สร้างแบบร่างก่อน แล้วเพิ่มสินค้าในขั้นถัดไป"
      />

      {params.error ? (
        <Notice tone="error">{params.error}</Notice>
      ) : null}

      <Panel aria-labelledby="po-new-title">
        <SectionHeader
          id="po-new-title"
          title="ข้อมูลใบสั่งซื้อ"
          description="เลือกผู้จำหน่ายและวันที่คาดว่าจะได้รับสินค้า"
        />

        {suppliers?.length ? (
          <form
            action={createPurchaseOrder}
            className="mt-5 grid gap-5"
          >
            <Field label="ผู้จำหน่าย" htmlFor="po-supplier" required>
              <NativeSelect
                id="po-supplier"
                name="supplier_id"
                required
                defaultValue=""
              >
                <option
                  value=""
                  disabled
                >
                  เลือกผู้จำหน่าย
                </option>
                {suppliers.map(
                  (supplier) => (
                    <option
                      key={supplier.id}
                      value={supplier.id}
                    >
                      {supplier.name}
                    </option>
                  ),
                )}
              </NativeSelect>
            </Field>

            <Field label="วันที่คาดว่าจะได้รับ" htmlFor="po-expected" hint="ไม่บังคับ">
              <Input
                id="po-expected"
                type="date"
                name="expected_date"
              />
            </Field>

            <Field label="หมายเหตุ" htmlFor="po-notes" hint="ไม่บังคับ">
              <Textarea
                id="po-notes"
                name="notes"
                rows={4}
                maxLength={2000}
                placeholder="เช่น ส่งช่วงเช้า / ติดต่อก่อนเข้าร้าน"
              />
            </Field>

            <MobileActionBar>
              <SubmitButton
                className="w-full sm:w-auto"
                pendingLabel="กำลังสร้าง..."
              >
                <FilePlus2 className="size-4" aria-hidden="true" />
                สร้างใบสั่งซื้อ
              </SubmitButton>
            </MobileActionBar>
          </form>
        ) : (
          <EmptyState
            className="mt-5"
            icon={Building2}
            title="ยังไม่มีผู้จำหน่ายที่เปิดใช้งาน"
            description="เพิ่มหรือเปิดใช้งานผู้จำหน่ายก่อนสร้างใบสั่งซื้อ"
            action={
              <Link
                href="/suppliers"
                className={buttonVariants({ variant: "outline" })}
              >
                ไปเพิ่มผู้จำหน่าย
              </Link>
            }
          />
        )}
      </Panel>
    </div>
  );
}
