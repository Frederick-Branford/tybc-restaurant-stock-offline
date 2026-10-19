import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { Boxes, History, PackageMinus } from "lucide-react";

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

import { StockOutForm } from "./stock-out-form";

export const metadata: Metadata = {
  title: "เบิกสินค้า",
};

type StockOutPageProps = {
  searchParams: Promise<{
    created?: string;
    error?: string;
  }>;
};

async function StockOutContent({
  searchParams,
}: StockOutPageProps) {
  await connection();
  const supabase =
    await createClient();

  const params =
    await searchParams;

  const [
    itemResult,
    balanceResult,
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

    supabase
      .from("stock_movements")
      .select(
        "id, item_id, input_quantity, input_unit_id, base_quantity, note, occurred_at",
      )
      .eq(
        "movement_type",
        "STOCK_OUT",
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
    balanceResult.error ||
    itemUnitResult.error ||
    unitResult.error ||
    movementResult.error
  ) {
    throw new Error(
      "Unable to load Stock Out information.",
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

  const balances =
    balanceResult.data ?? [];

  const balancesByItem =
    new Map(
      balances.map((balance) => [
        balance.item_id,
        balance,
      ]),
    );

  const itemUnits =
    itemUnitResult.data ?? [];

  const rawItems =
    itemResult.data ?? [];

  const items =
    rawItems.map((item) => {
      const balance =
        balancesByItem.get(
          item.id,
        );

      return {
        id: item.id,
        sku: item.sku,
        name: item.name,

        currentQuantity:
          Number(
            balance?.current_quantity ??
              0,
          ),

        baseUnitSymbol:
          balance?.base_unit_symbol ??
          "",

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
      };
    });

  const itemMap =
    new Map(
      rawItems.map((item) => [
        item.id,
        item,
      ]),
    );

  const errorMessage =
    params.error === "invalid"
      ? "ข้อมูลการเบิกสินค้าไม่ถูกต้อง"
      : params.error ===
          "insufficient"
        ? "สต็อกไม่เพียงพอ ระบบไม่อนุญาตให้ยอดติดลบ"
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
          quantity: `-${formatQuantity(
            movement.input_quantity,
            unit?.symbol ||
              unit?.code ||
              "",
          )}`,
          tone: "out",
          note: movement.note,
          occurredAt:
            movement.occurred_at,
        };
      },
    );

  return (
    <div className="space-y-6">
      <PageHeader
        icon={PackageMinus}
        title="เบิกสินค้า"
        description="บันทึกการเบิกวัตถุดิบไปใช้ ระบบไม่อนุญาตให้ยอดติดลบ"
      />

      {params.created === "1" ? (
        <Notice tone="success">
          เบิกสินค้าเรียบร้อยแล้ว
        </Notice>
      ) : null}

      {errorMessage ? (
        <Notice tone="error">{errorMessage}</Notice>
      ) : null}

      <div className="grid items-start gap-6 xl:grid-cols-2">
        <Panel aria-labelledby="stock-out-form-title">
          <SectionHeader
            id="stock-out-form-title"
            title="บันทึกการเบิก"
            description="ระบบจะตรวจยอดคงเหลืออีกครั้งก่อนบันทึก"
            icon={PackageMinus}
          />

          <div className="mt-5">
            {items.length === 0 ? (
              <EmptyState
                icon={Boxes}
                title="ยังไม่มีสินค้าในระบบ"
              />
            ) : (
              <StockOutForm
                items={items}
              />
            )}
          </div>
        </Panel>

        <TransactionHistory
          id="stock-out-history-title"
          title="การเบิกล่าสุด"
          description="แสดง 20 รายการล่าสุด"
          icon={History}
          rows={history}
          emptyTitle="ยังไม่มีประวัติการเบิกสินค้า"
        />
      </div>
    </div>
  );
}

function StockOutLoading() {
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

export default function StockOutPage(
  props: StockOutPageProps,
) {
  return (
    <Suspense fallback={<StockOutLoading />}>
      <StockOutContent {...props} />
    </Suspense>
  );
}
