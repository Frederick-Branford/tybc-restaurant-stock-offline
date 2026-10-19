import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { Boxes, History, Trash2 } from "lucide-react";

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

import { WasteForm } from "./waste-form";

export const metadata: Metadata = {
  title: "ของเสีย",
};

type WastePageProps = {
  searchParams: Promise<{
    created?: string;
    error?: string;
  }>;
};

async function WasteContent({
  searchParams,
}: WastePageProps) {
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
    reasonResult,
    wasteResult,
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
        "item_id, unit_id",
      )
      .eq("is_active", true),

    supabase
      .from("units")
      .select(
        "id, code, name, symbol",
      )
      .eq("is_active", true),

    supabase
      .from("waste_reasons")
      .select(
        "id, code, name",
      )
      .eq("is_active", true)
      .order("name"),

    supabase
      .from("waste_records")
      .select(
        "id, item_id, waste_reason_id, input_quantity, input_unit_id, base_quantity, note, occurred_at",
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
    reasonResult.error ||
    wasteResult.error
  ) {
    throw new Error(
      "Unable to load Waste information.",
    );
  }

  const rawItems =
    itemResult.data ?? [];

  const balances =
    balanceResult.data ?? [];

  const itemUnits =
    itemUnitResult.data ?? [];

  const units =
    unitResult.data ?? [];

  const reasons =
    reasonResult.data ?? [];

  const unitsById =
    new Map(
      units.map((unit) => [
        unit.id,
        unit,
      ]),
    );

  const balancesByItem =
    new Map(
      balances.map((balance) => [
        balance.item_id,
        balance,
      ]),
    );

  const items = rawItems.map(
    (item) => {
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
            };
          }),
      };
    },
  );

  const itemById =
    new Map(
      rawItems.map((item) => [
        item.id,
        item,
      ]),
    );

  const reasonById =
    new Map(
      reasons.map((reason) => [
        reason.id,
        reason,
      ]),
    );

  const errorMessage =
    params.error === "invalid"
      ? "ข้อมูลของเสียไม่ถูกต้อง"
      : params.error ===
          "insufficient"
        ? "สต็อกไม่เพียงพอ ระบบไม่อนุญาตให้ของเสียทำให้ยอดติดลบ"
        : null;

  const history: TransactionRow[] =
    (wasteResult.data ?? []).map(
      (record) => {
        const item =
          itemById.get(
            record.item_id,
          );

        const reason =
          reasonById.get(
            record.waste_reason_id,
          );

        const unit =
          unitsById.get(
            record.input_unit_id,
          );

        return {
          id: record.id,
          name:
            item?.name ??
            "สินค้าที่ปิดใช้งาน",
          sku: item?.sku,
          quantity: `-${formatQuantity(
            record.input_quantity,
            unit?.symbol ||
              unit?.code ||
              "",
          )}`,
          tone: "waste",
          reason: reason?.name,
          note: record.note,
          occurredAt:
            record.occurred_at,
        };
      },
    );

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Trash2}
        title="ของเสีย"
        description="บันทึกวัตถุดิบที่เสียหรือสูญเสีย พร้อมสาเหตุ ระบบจะปรับ Stock ให้ทันที"
      />

      {params.created === "1" ? (
        <Notice tone="success">
          บันทึกของเสียเรียบร้อยแล้ว
        </Notice>
      ) : null}

      {errorMessage ? (
        <Notice tone="error">{errorMessage}</Notice>
      ) : null}

      <div className="grid items-start gap-6 xl:grid-cols-2">
        <Panel aria-labelledby="waste-form-title">
          <SectionHeader
            id="waste-form-title"
            title="บันทึกของเสีย"
            description="ระบบบันทึกของเสียและปรับ Stock พร้อมกัน"
            icon={Trash2}
          />

          <div className="mt-5">
            {items.length === 0 ? (
              <EmptyState
                icon={Boxes}
                title="ยังไม่มีสินค้าในระบบ"
              />
            ) : (
              <WasteForm
                items={items}
                reasons={reasons}
              />
            )}
          </div>
        </Panel>

        <TransactionHistory
          id="waste-history-title"
          title="ของเสียล่าสุด"
          description="แสดง 20 รายการล่าสุด"
          icon={History}
          rows={history}
          emptyTitle="ยังไม่มีประวัติของเสีย"
          showReason
        />
      </div>
    </div>
  );
}

function WasteLoading() {
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

export default function WastePage(
  props: WastePageProps,
) {
  return (
    <Suspense fallback={<WasteLoading />}>
      <WasteContent {...props} />
    </Suspense>
  );
}
