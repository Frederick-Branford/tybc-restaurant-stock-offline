import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { Boxes, History, PackagePlus } from "lucide-react";

import { EmptyState } from "@/components/app/empty-state";
import { Notice } from "@/components/app/notice";
import {
  PageHeader,
  Panel,
  SectionHeader,
} from "@/components/app/page-header";
import {
  TransactionHistory,
  type TransactionRow,
} from "@/components/app/transaction-history";
import { Skeleton } from "@/components/ui/skeleton";
import { formatQuantity } from "@/lib/ui/format";
import { createClient } from "@/lib/supabase/server";

import { StockInForm } from "./stock-in-form";

export const metadata: Metadata = {
  title: "รับสินค้าเข้า",
};

type StockInPageProps = {
  searchParams: Promise<{
    created?: string;
    error?: string;
  }>;
};

async function StockInContent({
  searchParams,
}: StockInPageProps) {
  await connection();
  const supabase =
    await createClient();

  const params =
    await searchParams;

  const [
    itemResult,
    itemUnitResult,
    unitResult,
    movementResult,
  ] = await Promise.all([
    supabase
      .from("items")
      .select(
        "id, sku, name",
      )
      .eq("is_active", true)
      .order("name"),

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

    supabase
      .from("stock_movements")
      .select(
        "id, item_id, input_quantity, input_unit_id, base_quantity, note, occurred_at",
      )
      .eq(
        "movement_type",
        "STOCK_IN",
      )
      .order(
        "occurred_at",
        {
          ascending: false,
        },
      )
      .limit(20),
  ]);

  if (
    itemResult.error ||
    itemUnitResult.error ||
    unitResult.error ||
    movementResult.error
  ) {
    throw new Error(
      "Unable to load Stock In information.",
    );
  }

  const units =
    unitResult.data ?? [];

  const unitsById =
    new Map(
      units.map((unit) => [
        unit.id,
        unit,
      ]),
    );

  const itemUnits =
    itemUnitResult.data ?? [];

  const items =
    (itemResult.data ?? []).map(
      (item) => ({
        id: item.id,
        sku: item.sku,
        name: item.name,

        units: itemUnits
          .filter(
            (itemUnit) =>
              itemUnit.item_id ===
              item.id,
          )
          .map((itemUnit) => {
            const unit =
              unitsById.get(
                itemUnit.unit_id,
              );

            return {
              id:
                itemUnit.unit_id,

              label:
                unit
                  ? `${unit.name} (${unit.symbol || unit.code})`
                  : "Unknown Unit",

              conversionToBase:
                Number(
                  itemUnit.conversion_to_base,
                ),
            };
          }),
      }),
    );

  const itemMap =
    new Map(
      (itemResult.data ?? []).map(
        (item) => [
          item.id,
          item,
        ],
      ),
    );

  const errorMessage =
    params.error === "invalid"
      ? "ข้อมูลรับสินค้าไม่ถูกต้อง"
      : params.error === "item"
        ? "ไม่พบรายการสินค้า"
        : params.error === "unit"
          ? "หน่วยนี้ไม่ได้ตั้งค่าไว้สำหรับสินค้า"
          : params.error === "quantity"
            ? "จำนวนรับเข้าต้องมากกว่า 0"
            : null;

  const history: TransactionRow[] =
    (movementResult.data ?? []).map(
      (movement) => {
        const item =
          itemMap.get(
            movement.item_id,
          );

        const unit =
          unitsById.get(
            movement.input_unit_id,
          );

        return {
          id: movement.id,
          name:
            item?.name ??
            "สินค้าที่ปิดใช้งาน",
          sku: item?.sku,
          quantity: `+${formatQuantity(
            movement.input_quantity,
            unit?.symbol ||
              unit?.code ||
              "",
          )}`,
          tone: "in",
          note: movement.note,
          occurredAt:
            movement.occurred_at,
        };
      },
    );

  return (
    <div className="space-y-6">
      <PageHeader
        icon={PackagePlus}
        title="รับสินค้าเข้า"
        description="บันทึกวัตถุดิบและสินค้าที่เข้าร้าน ยอด Stock จะเพิ่มทันที"
      />

      {params.created === "1" ? (
        <Notice tone="success">
          รับสินค้าเข้าเรียบร้อยแล้ว
        </Notice>
      ) : null}

      {errorMessage ? (
        <Notice tone="error">{errorMessage}</Notice>
      ) : null}

      <div className="grid items-start gap-6 xl:grid-cols-2">
        <Panel aria-labelledby="stock-in-form-title">
          <SectionHeader
            id="stock-in-form-title"
            title="บันทึกรับสินค้า"
            description="บันทึกแล้วแก้ไขย้อนหลังไม่ได้ กรุณาตรวจจำนวนก่อนบันทึก"
            icon={PackagePlus}
          />

          <div className="mt-5">
            {items.length === 0 ? (
              <EmptyState
                icon={Boxes}
                title="ยังไม่มีสินค้า กรุณาสร้างสินค้าในหน้าคลังสินค้าก่อน"
              />
            ) : (
              <StockInForm
                items={items}
              />
            )}
          </div>
        </Panel>

        <TransactionHistory
          id="stock-in-history-title"
          title="การรับเข้าล่าสุด"
          description="แสดง 20 รายการล่าสุด"
          icon={History}
          rows={history}
          emptyTitle="ยังไม่มีประวัติรับสินค้าเข้า"
        />
      </div>
    </div>
  );
}

function StockInLoading() {
  return (
    <div className="space-y-6" aria-busy="true">
      <Skeleton className="h-12 w-48" />
      <div className="grid gap-6 xl:grid-cols-2">
        <Skeleton className="h-96 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    </div>
  );
}

export default function StockInPage(
  props: StockInPageProps,
) {
  return (
    <Suspense fallback={<StockInLoading />}>
      <StockInContent {...props} />
    </Suspense>
  );
}
