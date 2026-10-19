import type { Metadata } from "next";
import { Suspense } from "react";
import { connection } from "next/server";
import {
  Building2,
  ChevronDown,
  Mail,
  MapPin,
  Phone,
  Plus,
  Power,
  UserRound,
} from "lucide-react";

import { EmptyState } from "@/components/app/empty-state";
import { Field } from "@/components/app/form-controls";
import { Notice } from "@/components/app/notice";
import {
  PageHeader,
  Panel,
  SectionHeader,
} from "@/components/app/page-header";
import { StatusPill } from "@/components/app/stock-status-badge";
import { SubmitButton } from "@/components/app/submit-button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { formatCount } from "@/lib/ui/format";
import { createClient } from "@/lib/supabase/server";

import {
  createSupplier,
  setSupplierActive,
} from "./actions";

export const metadata: Metadata = {
  title: "ผู้จำหน่าย",
};

type Supplier = {
  id: string;
  name: string;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  tax_id: string | null;
  address: string | null;
  note: string | null;
  is_active: boolean;
};

type SuppliersPageProps = {
  searchParams: Promise<{
    success?: string;
    error?: string;
  }>;
};

function SuppliersLoading() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="h-8 w-32 animate-pulse rounded bg-muted" />
        <div className="h-4 w-72 max-w-full animate-pulse rounded bg-muted" />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="h-24 animate-pulse rounded-2xl border bg-muted/40" />
        <div className="h-24 animate-pulse rounded-2xl border bg-muted/40" />
      </div>

      <div className="h-80 animate-pulse rounded-2xl border bg-muted/40" />
    </div>
  );
}

export default function SuppliersPage(
  props: SuppliersPageProps,
) {
  return (
    <Suspense fallback={<SuppliersLoading />}>
      <SuppliersContent {...props} />
    </Suspense>
  );
}
async function SuppliersContent({
  searchParams,
}: SuppliersPageProps) {
  await connection();

  const params = await searchParams;

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("suppliers")
    .select(
      "id, name, contact_name, phone, email, tax_id, address, note, is_active",
    )
    .order("is_active", {
      ascending: false,
    })
    .order("name", {
      ascending: true,
    });

  if (error) {
    throw new Error(
      `Unable to load suppliers: ${error.message}`,
    );
  }

  const suppliers: Supplier[] =
    data ?? [];

  const activeCount =
    suppliers.filter(
      (supplier) =>
        supplier.is_active,
    ).length;

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Building2}
        title="ผู้จำหน่าย"
        description="รายชื่อ Supplier สำหรับการสั่งซื้อและรับสินค้าเข้าร้าน"
      />

      {params.success ? (
        <Notice tone="success">{params.success}</Notice>
      ) : null}

      {params.error ? (
        <Notice tone="error">{params.error}</Notice>
      ) : null}

      <ul
        className="grid grid-cols-2 divide-x rounded-xl border bg-card shadow-card"
        aria-label="สรุปผู้จำหน่าย"
      >
        <li className="px-4 py-3 md:px-5 md:py-4">
          <p className="text-sm text-muted-foreground">ทั้งหมด</p>
          <p className="text-2xl font-semibold tabular-nums">
            {formatCount(suppliers.length)}
          </p>
        </li>
        <li className="px-4 py-3 md:px-5 md:py-4">
          <p className="text-sm text-muted-foreground">เปิดใช้งาน</p>
          <p className="text-2xl font-semibold tabular-nums">
            {formatCount(activeCount)}
          </p>
        </li>
      </ul>

      <Panel aria-labelledby="supplier-list-title">
        <SectionHeader
          id="supplier-list-title"
          title="รายชื่อผู้จำหน่าย"
          description="ใช้เลือก Supplier ตอนสร้างใบสั่งซื้อ"
          icon={Building2}
        />

        {suppliers.length === 0 ? (
          <EmptyState
            className="mt-4"
            icon={Building2}
            title="ยังไม่มีผู้จำหน่าย"
            description="เพิ่ม Supplier รายแรกจากแบบฟอร์มด้านล่าง"
          />
        ) : (
          <ul className="mt-4 grid gap-3 md:grid-cols-2">
            {suppliers.map(
              (supplier) => (
                <li
                  key={supplier.id}
                  className={cn(
                    "flex flex-col rounded-xl border p-4",
                    supplier.is_active
                      ? "bg-card"
                      : "bg-surface-muted/60",
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="font-semibold text-foreground">
                        {supplier.name}
                      </h3>
                      {supplier.tax_id ? (
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          เลขผู้เสียภาษี {supplier.tax_id}
                        </p>
                      ) : null}
                    </div>

                    {supplier.is_active ? (
                      <StatusPill tone="success">ใช้งาน</StatusPill>
                    ) : (
                      <StatusPill>ปิดใช้งาน</StatusPill>
                    )}
                  </div>

                  <dl className="mt-3 grid gap-2 text-sm">
                    {supplier.contact_name ? (
                      <div className="flex items-start gap-2">
                        <dt className="sr-only">ผู้ติดต่อ</dt>
                        <UserRound className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                        <dd>{supplier.contact_name}</dd>
                      </div>
                    ) : null}

                    {supplier.phone ? (
                      <div className="flex items-start gap-2">
                        <dt className="sr-only">โทรศัพท์</dt>
                        <Phone className="mt-3 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                        <dd>
                          <a
                            href={`tel:${supplier.phone.replace(/[^0-9+]/g, "")}`}
                            className="inline-flex min-h-10 items-center font-medium text-brand-deep underline-offset-4 hover:underline"
                          >
                            {supplier.phone}
                          </a>
                        </dd>
                      </div>
                    ) : null}

                    {supplier.email ? (
                      <div className="flex items-start gap-2">
                        <dt className="sr-only">อีเมล</dt>
                        <Mail className="mt-3 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                        <dd className="min-w-0 break-all">
                          <a
                            href={`mailto:${supplier.email}`}
                            className="inline-flex min-h-10 items-center text-brand-deep underline-offset-4 hover:underline"
                          >
                            {supplier.email}
                          </a>
                        </dd>
                      </div>
                    ) : null}

                    {supplier.address ? (
                      <div className="flex items-start gap-2">
                        <dt className="sr-only">ที่อยู่</dt>
                        <MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                        <dd className="text-muted-foreground">{supplier.address}</dd>
                      </div>
                    ) : null}
                  </dl>

                  {supplier.note ? (
                    <p className="mt-3 rounded-lg bg-surface-warm px-3 py-2 text-sm text-muted-foreground">
                      {supplier.note}
                    </p>
                  ) : null}

                  <form
                    action={setSupplierActive}
                    className="mt-auto pt-4"
                  >
                    <input
                      type="hidden"
                      name="supplier_id"
                      value={supplier.id}
                    />
                    <input
                      type="hidden"
                      name="next_active"
                      value={
                        supplier.is_active
                          ? "false"
                          : "true"
                      }
                    />
                    <SubmitButton
                      variant="outline"
                      pendingLabel="กำลังบันทึก..."
                      aria-label={`${supplier.is_active ? "ปิดใช้งาน" : "เปิดใช้งาน"} ${supplier.name}`}
                    >
                      <Power className="size-4" aria-hidden="true" />
                      {supplier.is_active
                        ? "ปิดใช้งาน"
                        : "เปิดใช้งาน"}
                    </SubmitButton>
                  </form>
                </li>
              ),
            )}
          </ul>
        )}
      </Panel>

      <details
        className="group rounded-xl border bg-card shadow-card"
        open={suppliers.length === 0 || Boolean(params.error)}
      >
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-xl p-4 md:p-5 [&::-webkit-details-marker]:hidden">
          <span className="flex min-w-0 items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-brand-deep">
              <Plus className="size-[1.125rem]" aria-hidden="true" />
            </span>
            <span className="min-w-0">
              <span className="block text-base font-semibold text-foreground">
                เพิ่มผู้จำหน่าย
              </span>
              <span className="block text-sm text-muted-foreground">
                ข้อมูลนี้จะถูกใช้ตอนสร้างใบสั่งซื้อ
              </span>
            </span>
          </span>
          <ChevronDown
            className="size-5 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
            aria-hidden="true"
          />
        </summary>

        <form
          action={createSupplier}
          className="grid gap-4 border-t p-4 md:grid-cols-2 md:p-5"
        >
          <Field label="ชื่อผู้จำหน่าย" htmlFor="supplier-name" required>
            <Input
              id="supplier-name"
              name="name"
              required
              maxLength={160}
              placeholder="เช่น บริษัท ABC Food Supply"
            />
          </Field>

          <Field label="ผู้ติดต่อ" htmlFor="supplier-contact">
            <Input
              id="supplier-contact"
              name="contact_name"
              maxLength={160}
              placeholder="ชื่อพนักงานขาย / ผู้ประสานงาน"
            />
          </Field>

          <Field label="เบอร์โทรศัพท์" htmlFor="supplier-phone">
            <Input
              id="supplier-phone"
              name="phone"
              type="tel"
              maxLength={50}
              inputMode="tel"
              placeholder="08x-xxx-xxxx"
            />
          </Field>

          <Field label="อีเมล" htmlFor="supplier-email">
            <Input
              id="supplier-email"
              name="email"
              type="email"
              maxLength={160}
              placeholder="supplier@example.com"
            />
          </Field>

          <Field label="เลขประจำตัวผู้เสียภาษี" htmlFor="supplier-tax" hint="ถ้ามี">
            <Input
              id="supplier-tax"
              name="tax_id"
              maxLength={50}
              inputMode="numeric"
            />
          </Field>

          <Field label="ที่อยู่" htmlFor="supplier-address" className="md:col-span-2">
            <Textarea
              id="supplier-address"
              name="address"
              rows={3}
              maxLength={1000}
              placeholder="ที่อยู่ของ Supplier"
            />
          </Field>

          <Field label="หมายเหตุ" htmlFor="supplier-note" className="md:col-span-2">
            <Textarea
              id="supplier-note"
              name="note"
              rows={3}
              maxLength={1000}
              placeholder="เช่น ส่งของวันจันทร์และพฤหัสบดี"
            />
          </Field>

          <div className="md:col-span-2">
            <SubmitButton className="w-full sm:w-auto">
              <Plus className="size-4" aria-hidden="true" />
              เพิ่มผู้จำหน่าย
            </SubmitButton>
          </div>
        </form>
      </details>
    </div>
  );
}
