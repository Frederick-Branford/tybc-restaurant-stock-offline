import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import Link from "next/link";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Filter,
  History,
  Scale,
} from "lucide-react";

import { EmptyState } from "@/components/app/empty-state";
import {
  Field,
  NativeSelect,
} from "@/components/app/form-controls";
import {
  PageHeader,
  Panel,
  SectionHeader,
} from "@/components/app/page-header";
import {
  RecordItem,
  RecordList,
} from "@/components/app/record-list";
import { Button, buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  formatActivityTime,
  formatCount,
  formatDateTime,
  formatSignedQuantity,
} from "@/lib/ui/format";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "ประวัติสต็อก",
};

type MovementPageProps = {
  searchParams: Promise<{
    item?: string;
    type?: string;
  }>;
};

const movementTypes = [
  {
    value: "OPENING_BALANCE",
    label: "ยอดยกมา",
  },
  {
    value: "STOCK_IN",
    label: "รับสินค้าเข้า",
  },
  {
    value: "STOCK_OUT",
    label: "เบิกสินค้า",
  },
  {
    value: "WASTE",
    label: "ของเสีย",
  },
  {
    value: "COUNT_ADJUSTMENT",
    label: "ปรับจากการนับ",
  },
  {
    value: "MANUAL_ADJUSTMENT",
    label: "ปรับสต็อก",
  },
  {
    value: "PO_RECEIVE",
    label: "รับสินค้าจาก PO",
  },
  {
    value: "POS_DEDUCTION",
    label: "ตัดจาก POS",
  },
  {
    value: "RETURN_IN",
    label: "รับคืนเข้า",
  },
  {
    value: "RETURN_OUT",
    label: "คืนสินค้าออก",
  },
] as const;

function movementLabel(
  movementType: string,
) {
  return (
    movementTypes.find(
      (type) =>
        type.value === movementType,
    )?.label ?? movementType
  );
}

function reasonLabel(
  reason: string | null,
) {
  if (!reason) {
    return "-";
  }

  const labels: Record<
    string,
    string
  > = {
    MANUAL_STOCK_IN:
      "รับเข้าด้วยมือ",

    MANUAL_STOCK_OUT:
      "เบิกด้วยมือ",

    SPOILED:
      "เน่าเสีย / เสีย",

    EXPIRED:
      "หมดอายุ",

    DAMAGED:
      "เสียหาย",

    PREP_LOSS:
      "สูญเสียระหว่างเตรียม",

    OVERPRODUCTION:
      "ผลิตเกิน",

    SPILLAGE:
      "หก / รั่วไหล",

    OTHER:
      "อื่น ๆ",

    PHYSICAL_COUNT:
      "ตรวจนับสต็อกจริง",
  };

  return labels[reason] ?? reason;
}

async function MovementContent({
  searchParams,
}: MovementPageProps) {
  await connection();
  const params =
    await searchParams;

  const supabase =
    await createClient();

  const itemFilter =
    params.item ?? "";

  const typeFilter =
    params.type ?? "";

  let movementQuery =
    supabase
      .from("stock_movements")
      .select(
        "id, item_id, movement_type, input_quantity, input_unit_id, base_unit_id, base_quantity, reason_code, note, reference_type, reference_id, occurred_at",
      )
      .order(
        "occurred_at",
        {
          ascending: false,
        },
      )
      .limit(200);

  if (itemFilter) {
    movementQuery =
      movementQuery.eq(
        "item_id",
        itemFilter,
      );
  }

  if (typeFilter) {
    movementQuery =
      movementQuery.eq(
        "movement_type",
        typeFilter,
      );
  }

  const [
    movementResult,
    itemResult,
    unitResult,
  ] = await Promise.all([
    movementQuery,

    supabase
      .from("items")
      .select(
        "id, sku, name",
      )
      .order("name"),

    supabase
      .from("units")
      .select(
        "id, code, symbol",
      ),
  ]);

  if (
    movementResult.error ||
    itemResult.error ||
    unitResult.error
  ) {
    throw new Error(
      "Unable to load Stock Movement History.",
    );
  }

  const movements =
    movementResult.data ?? [];

  const items =
    itemResult.data ?? [];

  const units =
    unitResult.data ?? [];

  const itemById =
    new Map(
      items.map((item) => [
        item.id,
        item,
      ]),
    );

  const unitById =
    new Map(
      units.map((unit) => [
        unit.id,
        unit,
      ]),
    );

  const inboundCount =
    movements.filter(
      (movement) =>
        Number(
          movement.base_quantity,
        ) > 0,
    ).length;

  const outboundCount =
    movements.filter(
      (movement) =>
        Number(
          movement.base_quantity,
        ) < 0,
    ).length;

  const totalMovementCount =
    movements.length;

  const rows = movements.map(
    (movement) => {
      const item =
        itemById.get(
          movement.item_id,
        );

      const baseUnit =
        unitById.get(
          movement.base_unit_id,
        );

      const quantity =
        Number(
          movement.base_quantity,
        );

      const symbol =
        baseUnit?.symbol ||
        baseUnit?.code ||
        "";

      return {
        id: movement.id,
        name:
          item?.name ??
          "สินค้าที่ปิดใช้งาน",
        sku: item?.sku ?? "",
        type: movementLabel(
          movement.movement_type,
        ),
        reason: movement.reason_code
          ? reasonLabel(
              movement.reason_code,
            )
          : null,
        note: movement.note,
        quantity:
          formatSignedQuantity(
            quantity,
            symbol,
          ),
        tone:
          movement.movement_type ===
          "WASTE"
            ? "text-danger"
            : quantity > 0
              ? "text-success"
              : "text-foreground",
        occurredAt:
          movement.occurred_at,
      };
    },
  );

  const hasFilter =
    Boolean(itemFilter) ||
    Boolean(typeFilter);

  const summary = [
    {
      label: "รับเข้า",
      value: inboundCount,
      icon: ArrowDownToLine,
      className: "text-success",
    },
    {
      label: "ออกจากสต็อก",
      value: outboundCount,
      icon: ArrowUpFromLine,
      className: "text-brand",
    },
    {
      label: "ทั้งหมด",
      value: totalMovementCount,
      icon: Scale,
      className: "text-muted-foreground",
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        icon={History}
        title="ประวัติสต็อก"
        description="ทุกการเคลื่อนไหวของ Stock ย้อนหลัง บันทึกแล้วแก้ไขไม่ได้"
      />

      <ul
        className="grid grid-cols-3 divide-x rounded-xl border bg-card shadow-card"
        aria-label="สรุปรายการที่แสดง"
      >
        {summary.map((entry) => {
          const Icon = entry.icon;

          return (
            <li
              key={entry.label}
              className="flex flex-col gap-1 px-3 py-3 md:px-5 md:py-4"
            >
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground md:text-sm">
                <Icon
                  className={`size-4 shrink-0 ${entry.className}`}
                  aria-hidden="true"
                />
                {entry.label}
              </span>
              <span className="text-xl font-semibold text-foreground tabular-nums md:text-2xl">
                {formatCount(entry.value)}
              </span>
            </li>
          );
        })}
      </ul>

      <Panel aria-labelledby="movement-filter-title">
        <SectionHeader
          id="movement-filter-title"
          title="ตัวกรอง"
          description="ค้นหาตามสินค้าและประเภทการเคลื่อนไหว"
          icon={Filter}
        />

        <form
          method="get"
          className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto_auto] md:items-end"
        >
          <Field label="สินค้า" htmlFor="movement-item">
            <NativeSelect
              id="movement-item"
              name="item"
              defaultValue={
                itemFilter
              }
            >
              <option value="">
                สินค้าทั้งหมด
              </option>
              {items.map((item) => (
                <option
                  key={item.id}
                  value={item.id}
                >
                  {item.name}
                  {" · "}
                  {item.sku}
                </option>
              ))}
            </NativeSelect>
          </Field>

          <Field label="ประเภท" htmlFor="movement-type">
            <NativeSelect
              id="movement-type"
              name="type"
              defaultValue={
                typeFilter
              }
            >
              <option value="">
                ทุกประเภท
              </option>
              {movementTypes.map(
                (type) => (
                  <option
                    key={type.value}
                    value={
                      type.value
                    }
                  >
                    {type.label}
                  </option>
                ),
              )}
            </NativeSelect>
          </Field>

          <Button type="submit">
            <Filter className="size-4" aria-hidden="true" />
            กรอง
          </Button>

          <Link
            href="/movements"
            className={buttonVariants({ variant: "outline" })}
          >
            ล้างตัวกรอง
          </Link>
        </form>
      </Panel>

      <Panel aria-labelledby="ledger-title">
        <SectionHeader
          id="ledger-title"
          title="รายการเคลื่อนไหว"
          description="แสดงสูงสุด 200 รายการล่าสุด"
          icon={History}
        />

        {rows.length === 0 ? (
          <EmptyState
            className="mt-4"
            icon={History}
            title="ไม่พบประวัติสต็อก"
            description={
              hasFilter
                ? "ลองเปลี่ยนหรือล้างตัวกรอง"
                : undefined
            }
          />
        ) : (
          <>
            <RecordList
              className="mt-4 lg:hidden"
              label="รายการเคลื่อนไหว"
            >
              {rows.map((row) => (
                <RecordItem
                  key={row.id}
                  title={row.name}
                  subtitle={`${row.type} · ${formatActivityTime(row.occurredAt)}`}
                  meta={
                    row.reason || row.note
                      ? [row.reason, row.note]
                          .filter(Boolean)
                          .join(" · ")
                      : undefined
                  }
                  value={row.quantity}
                  valueClassName={row.tone}
                />
              ))}
            </RecordList>

            <div className="mt-4 hidden overflow-hidden rounded-xl border lg:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>สินค้า</TableHead>
                    <TableHead>ประเภท</TableHead>
                    <TableHead className="text-right">
                      จำนวน
                    </TableHead>
                    <TableHead>เหตุผล</TableHead>
                    <TableHead>หมายเหตุ</TableHead>
                    <TableHead>เวลา</TableHead>
                  </TableRow>
                </TableHeader>

                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="whitespace-normal">
                        <p className="font-medium text-foreground">
                          {row.name}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {row.sku}
                        </p>
                      </TableCell>
                      <TableCell>{row.type}</TableCell>
                      <TableCell
                        className={`text-right font-semibold tabular-nums ${row.tone}`}
                      >
                        {row.quantity}
                      </TableCell>
                      <TableCell className="whitespace-normal text-muted-foreground">
                        {row.reason ?? "-"}
                      </TableCell>
                      <TableCell className="max-w-56 whitespace-normal text-muted-foreground">
                        {row.note || "-"}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatDateTime(row.occurredAt)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </Panel>
    </div>
  );
}

function MovementLoading() {
  return (
    <div className="space-y-6" aria-busy="true">
      <Skeleton className="h-12 w-52" />
      <Skeleton className="h-20" />
      <Skeleton className="h-36" />
      <Skeleton className="h-96" />
    </div>
  );
}

export default function MovementPage(
  props: MovementPageProps,
) {
  return (
    <Suspense
      fallback={
        <MovementLoading />
      }
    >
      <MovementContent
        {...props}
      />
    </Suspense>
  );
}
