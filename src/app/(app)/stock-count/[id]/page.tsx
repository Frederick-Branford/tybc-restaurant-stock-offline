import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  CheckCircle2,
  CircleDashed,
  ClipboardCheck,
  Clock3,
  Save,
} from "lucide-react";

import { NativeSelect } from "@/components/app/form-controls";
import { Notice } from "@/components/app/notice";
import { PageHeader } from "@/components/app/page-header";
import { StatusPill } from "@/components/app/stock-status-badge";
import { SubmitButton } from "@/components/app/submit-button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  formatCount,
  formatQuantity,
  formatSignedQuantity,
} from "@/lib/ui/format";
import { createClient } from "@/lib/supabase/server";

import {
  completeStockCount,
  recordCountItem,
} from "../actions";

export const metadata: Metadata = {
  title: "รอบนับสต็อก",
};

type PageProps = {
  params: Promise<{
    id: string;
  }>;

  searchParams: Promise<{
    saved?: string;
    completed?: string;
    error?: string;
  }>;
};

async function StockCountDetail({
  params,
  searchParams,
}: PageProps) {
  const { id } = await params;
  const query = await searchParams;

  const supabase = await createClient();

  const {
    data: stockCount,
    error: stockCountError,
  } = await supabase
    .from("stock_counts")
    .select(
      "id, count_code, status, notes, started_at, completed_at",
    )
    .eq("id", id)
    .maybeSingle();

  if (stockCountError) {
    throw new Error(
      `Unable to load stock count: ${stockCountError.message}`,
    );
  }

  if (!stockCount) {
    notFound();
  }

  const [
    countItemsResult,
    itemsResult,
    balancesResult,
    itemUnitsResult,
    unitsResult,
  ] = await Promise.all([
    supabase
      .from("stock_count_items")
      .select(
        "id, item_id, base_unit_id, system_quantity_snapshot, input_quantity, input_unit_id, actual_quantity_base, variance_quantity, adjustment_movement_id",
      )
      .eq("stock_count_id", id),

    supabase
      .from("items")
      .select("id, sku, name"),

    supabase
      .from("inventory_balances")
      .select(
        "item_id, current_quantity, base_unit_symbol",
      ),

    supabase
      .from("item_units")
      .select(
        "item_id, unit_id, conversion_to_base",
      )
      .eq("is_active", true),

    supabase
      .from("units")
      .select(
        "id, code, name, symbol",
      )
      .eq("is_active", true),
  ]);

  if (
    countItemsResult.error ||
    itemsResult.error ||
    balancesResult.error ||
    itemUnitsResult.error ||
    unitsResult.error
  ) {
    throw new Error(
      "Unable to load physical stock count information.",
    );
  }

  const countItems =
    countItemsResult.data ?? [];

  const items =
    itemsResult.data ?? [];

  const balances =
    balancesResult.data ?? [];

  const itemUnits =
    itemUnitsResult.data ?? [];

  const units =
    unitsResult.data ?? [];

  const itemById = new Map(
    items.map((item) => [
      item.id,
      item,
    ]),
  );

  const balanceByItem = new Map(
    balances.map((balance) => [
      balance.item_id,
      balance,
    ]),
  );

  const unitById = new Map(
    units.map((unit) => [
      unit.id,
      unit,
    ]),
  );

  const countedItems =
    countItems.filter(
      (item) =>
        item.actual_quantity_base !== null,
    ).length;

  const totalItems =
    countItems.length;

  const isComplete =
    stockCount.status === "COMPLETED";

  const allCounted =
    totalItems > 0 &&
    countedItems === totalItems;

  const errorMessage =
    query.error === "incomplete"
      ? "กรุณานับสินค้าให้ครบทุกชนิดก่อนปิดรอบ"
      : query.error === "stale"
        ? "Stock มีการเปลี่ยนแปลงหลังจากนับ กรุณานับรายการใหม่อีกครั้ง"
        : null;

  const progress =
    totalItems > 0
      ? Math.round(
          (countedItems / totalItems) * 100,
        )
      : 0;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={
          <Link
            href="/stock-count"
            className="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
            นับสต็อกทั้งหมด
          </Link>
        }
        title={
          <span className="flex flex-wrap items-center gap-2">
            {stockCount.count_code}
            {isComplete ? (
              <StatusPill tone="success" icon={CheckCircle2}>
                เสร็จสิ้น
              </StatusPill>
            ) : (
              <StatusPill tone="warning" icon={Clock3}>
                กำลังนับ
              </StatusPill>
            )}
          </span>
        }
        description={
          stockCount.notes ||
          "ตรวจนับสต็อกจริงของร้าน"
        }
        actions={
          !isComplete ? (
            <form action={completeStockCount}>
              <input
                type="hidden"
                name="stockCountId"
                value={stockCount.id}
              />
              <SubmitButton
                disabled={!allCounted}
                pendingLabel="กำลังปิดรอบนับ..."
                className="w-full md:w-auto"
              >
                <CheckCircle2 className="size-4" aria-hidden="true" />
                ปิดรอบนับและปรับ Stock
              </SubmitButton>
            </form>
          ) : null
        }
      />

      <div className="rounded-xl border bg-card p-4 shadow-card md:p-5">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-sm font-medium text-muted-foreground">
            ความคืบหน้า
          </p>
          <p className="text-sm text-muted-foreground">
            นับแล้ว{" "}
            <span className="text-lg font-semibold text-foreground tabular-nums">
              {formatCount(countedItems)} / {formatCount(totalItems)}
            </span>{" "}
            รายการ
          </p>
        </div>
        <div
          role="progressbar"
          aria-label="ความคืบหน้าการนับ"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress}
          className="mt-3 h-2.5 overflow-hidden rounded-full bg-surface-muted"
        >
          <div
            className="h-full rounded-full bg-brand"
            style={{ width: `${progress}%` }}
          />
        </div>
        {!isComplete && !allCounted ? (
          <p className="mt-2 text-xs text-muted-foreground">
            ต้องนับให้ครบทุกรายการก่อนปิดรอบ
          </p>
        ) : null}
      </div>

      {query.saved === "1" ? (
        <Notice tone="success">
          บันทึกยอดนับเรียบร้อยแล้ว
        </Notice>
      ) : null}

      {query.completed === "1" ? (
        <Notice tone="success">
          ปิดรอบนับสำเร็จและปรับ Stock แล้ว
        </Notice>
      ) : null}

      {errorMessage ? (
        <Notice tone="error">{errorMessage}</Notice>
      ) : null}

      <section aria-labelledby="count-items-title">
        <h2 id="count-items-title" className="sr-only">
          รายการตรวจนับ
        </h2>

        <ul className="grid gap-3 lg:grid-cols-2">
          {countItems.map(
            (countItem) => {
              const item =
                itemById.get(
                  countItem.item_id,
                );

              const balance =
                balanceByItem.get(
                  countItem.item_id,
                );

              const baseUnit =
                unitById.get(
                  countItem.base_unit_id,
                );

              const availableUnits =
                itemUnits
                  .filter(
                    (itemUnit) =>
                      itemUnit.item_id ===
                      countItem.item_id,
                  )
                  .map((itemUnit) => ({
                    id:
                      itemUnit.unit_id,
                    unit:
                      unitById.get(
                        itemUnit.unit_id,
                      ),
                  }));

              const symbol =
                balance?.base_unit_symbol ||
                baseUnit?.symbol ||
                baseUnit?.code ||
                "";

              const hasBeenCounted =
                countItem.actual_quantity_base !==
                null;

              const variance =
                countItem.variance_quantity ===
                null
                  ? null
                  : Number(
                      countItem.variance_quantity,
                    );

              const name =
                item?.name ||
                "สินค้าที่ปิดใช้งาน";

              const facts = [
                {
                  label: "Stock ตอนนี้",
                  value: formatQuantity(
                    balance?.current_quantity ?? 0,
                    symbol,
                  ),
                },
                {
                  label: "ยอดระบบตอนนับ",
                  value:
                    countItem.system_quantity_snapshot ===
                    null
                      ? "-"
                      : formatQuantity(
                          countItem.system_quantity_snapshot,
                          symbol,
                        ),
                },
                {
                  label: "นับได้จริง",
                  value:
                    countItem.actual_quantity_base ===
                    null
                      ? "-"
                      : formatQuantity(
                          countItem.actual_quantity_base,
                          symbol,
                        ),
                },
                {
                  label: "ส่วนต่าง",
                  value:
                    variance === null
                      ? "-"
                      : formatSignedQuantity(
                          variance,
                          symbol,
                        ),
                  tone:
                    variance === null ||
                    variance === 0
                      ? undefined
                      : "text-warning",
                },
              ];

              return (
                <li
                  key={countItem.id}
                  className={cn(
                    "rounded-xl border bg-card p-4 shadow-card",
                    hasBeenCounted
                      ? "border-success-border"
                      : undefined,
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold text-foreground">
                        {name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {item?.sku || ""}
                      </p>
                    </div>

                    {hasBeenCounted ? (
                      <StatusPill tone="success" icon={CheckCircle2}>
                        นับแล้ว
                      </StatusPill>
                    ) : (
                      <StatusPill icon={CircleDashed}>
                        ยังไม่นับ
                      </StatusPill>
                    )}
                  </div>

                  <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {facts.map((fact) => (
                      <div
                        key={fact.label}
                        className="rounded-lg bg-surface-warm px-3 py-2"
                      >
                        <dt className="text-xs text-muted-foreground">
                          {fact.label}
                        </dt>
                        <dd
                          className={cn(
                            "mt-0.5 text-sm font-semibold text-foreground tabular-nums",
                            fact.tone,
                          )}
                        >
                          {fact.value}
                        </dd>
                      </div>
                    ))}
                  </dl>

                  {isComplete ? null : (
                    <form
                      action={
                        recordCountItem
                      }
                      className="mt-3 grid grid-cols-[minmax(0,1fr)_6.5rem] gap-2 sm:grid-cols-[minmax(0,1fr)_7.5rem_auto]"
                    >
                      <input
                        type="hidden"
                        name="stockCountId"
                        value={
                          stockCount.id
                        }
                      />
                      <input
                        type="hidden"
                        name="itemId"
                        value={
                          countItem.item_id
                        }
                      />

                      <Input
                        name="quantity"
                        type="number"
                        inputMode="decimal"
                        min="0"
                        step="0.0001"
                        required
                        defaultValue={
                          countItem.input_quantity ??
                          ""
                        }
                        placeholder="จำนวนที่นับได้"
                        aria-label={`จำนวนที่นับได้ของ ${name}`}
                        className="font-semibold tabular-nums"
                      />

                      <NativeSelect
                        name="inputUnitId"
                        required
                        aria-label={`หน่วยที่นับของ ${name}`}
                        defaultValue={
                          countItem.input_unit_id ??
                          countItem.base_unit_id
                        }
                      >
                        {availableUnits.map(
                          ({
                            id: unitId,
                            unit,
                          }) => (
                            <option
                              key={
                                unitId
                              }
                              value={
                                unitId
                              }
                            >
                              {unit?.symbol ||
                                unit?.code ||
                                "หน่วย"}
                            </option>
                          ),
                        )}
                      </NativeSelect>

                      <SubmitButton
                        variant={hasBeenCounted ? "outline" : "default"}
                        className="col-span-2 sm:col-span-1"
                        pendingLabel="กำลังบันทึก..."
                      >
                        <Save className="size-4" aria-hidden="true" />
                        {hasBeenCounted
                          ? "อัปเดต"
                          : "บันทึก"}
                      </SubmitButton>
                    </form>
                  )}
                </li>
              );
            },
          )}
        </ul>
      </section>

      {isComplete ? null : (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <ClipboardCheck className="size-4" aria-hidden="true" />
          ระบบจะบันทึกยอด Stock ณ เวลาที่นับจริงของแต่ละรายการ
        </p>
      )}
    </div>
  );
}

function DetailLoading() {
  return (
    <div className="space-y-6" aria-busy="true">
      <Skeleton className="h-14 w-72" />
      <Skeleton className="h-24 w-full" />
      <div className="grid gap-3 lg:grid-cols-2">
        <Skeleton className="h-48" />
        <Skeleton className="h-48" />
      </div>
    </div>
  );
}

export default function StockCountDetailPage(
  props: PageProps,
) {
  return (
    <Suspense fallback={<DetailLoading />}>
      <StockCountDetail
        {...props}
      />
    </Suspense>
  );
}
