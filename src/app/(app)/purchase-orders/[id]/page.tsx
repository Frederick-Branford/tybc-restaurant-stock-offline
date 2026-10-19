import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import {
  notFound,
} from "next/navigation";
import { connection } from "next/server";
import {
  ArrowLeft,
  CheckCircle2,
  ListPlus,
  PackagePlus,
  ShoppingCart,
  Trash2,
  XCircle,
} from "lucide-react";

import { EmptyState } from "@/components/app/empty-state";
import {
  Field,
  NativeSelect,
} from "@/components/app/form-controls";
import { Notice } from "@/components/app/notice";
import {
  PageHeader,
  Panel,
  SectionHeader,
} from "@/components/app/page-header";
import { PurchaseOrderStatus } from "@/components/app/po-status";
import { SubmitButton } from "@/components/app/submit-button";
import { Input } from "@/components/ui/input";
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
  formatDate,
  formatQuantity,
} from "@/lib/ui/format";
import { createClient } from "@/lib/supabase/server";

import { ReceivingSection } from "./receiving-section";
import {
  addPurchaseOrderItem,
  cancelPurchaseOrder,
  confirmPurchaseOrder,
  deletePurchaseOrderItem,
} from "../actions";

export const metadata: Metadata = {
  title: "รายละเอียดใบสั่งซื้อ",
};

function formatUnitCost(value: number | string | null) {
  return value === null
    ? "-"
    : Number(value).toLocaleString("th-TH", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 4,
      });
}

function DeleteLine({
  orderId,
  lineId,
  name,
}: {
  orderId: string;
  lineId: string;
  name: string;
}) {
  return (
    <form
      action={
        deletePurchaseOrderItem
      }
    >
      <input
        type="hidden"
        name="purchase_order_id"
        value={orderId}
      />
      <input
        type="hidden"
        name="purchase_order_item_id"
        value={lineId}
      />
      <SubmitButton
        variant="destructive"
        size="icon"
        aria-label={`ลบ ${name} ออกจากใบสั่งซื้อ`}
        title="ลบรายการ"
        pendingLabel={
          <span className="sr-only">
            กำลังลบ
          </span>
        }
      >
        <Trash2 className="size-4" aria-hidden="true" />
      </SubmitButton>
    </form>
  );
}

type PurchaseOrderDetailProps = {
  params: Promise<{
    id: string;
  }>;

  searchParams: Promise<{
    success?: string;
    error?: string;
  }>;
};

function Loading() {
  return (
    <div className="space-y-6" aria-busy="true">
      <Skeleton className="h-14 w-64" />
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-96 w-full" />
    </div>
  );
}

export default function PurchaseOrderDetailPage(
  props: PurchaseOrderDetailProps,
) {
  return (
    <Suspense fallback={<Loading />}>
      <PurchaseOrderDetailContent
        {...props}
      />
    </Suspense>
  );
}

async function PurchaseOrderDetailContent({
  params,
  searchParams,
}: PurchaseOrderDetailProps) {
  await connection();

  const { id } =
    await params;

  const messages =
    await searchParams;

  const supabase =
    await createClient();

  const {
    data: order,
    error: orderError,
  } = await supabase
    .from("purchase_orders")
    .select(
      "id, po_number, supplier_id, status, ordered_at, expected_at, notes, created_at",
    )
    .eq("id", id)
    .maybeSingle();

  if (
    orderError ||
    !order
  ) {
    notFound();
  }

  const {
    data: supplier,
  } = await supabase
    .from("suppliers")
    .select("id, name")
    .eq(
      "id",
      order.supplier_id,
    )
    .maybeSingle();

  const {
    data: lines,
    error: linesError,
  } = await supabase
    .from(
      "purchase_order_items",
    )
    .select(
      "id, item_id, ordered_quantity, order_unit_id, conversion_to_base, ordered_base_quantity, unit_cost, received_quantity, received_base_quantity",
    )
    .eq(
      "purchase_order_id",
      order.id,
    )
    .order(
      "created_at",
      {
        ascending: true,
      },
    );

  if (linesError) {
    throw new Error(
      `Unable to load PO items: ${linesError.message}`,
    );
  }

  const {
    data: items,
    error: itemError,
  } = await supabase
    .from("items")
    .select(
      "id, sku, name, base_unit_id",
    )
    .eq(
      "is_active",
      true,
    )
    .order("name");

  if (itemError) {
    throw new Error(
      `Unable to load inventory items: ${itemError.message}`,
    );
  }

  const itemIds =
    (items ?? []).map(
      (item) => item.id,
    );

  const {
    data: itemUnits,
    error: unitError,
  } =
    itemIds.length > 0
      ? await supabase
          .from("item_units")
          .select(
            "item_id, unit_id, conversion_to_base",
          )
          .in(
            "item_id",
            itemIds,
          )
          .eq(
            "is_active",
            true,
          )
      : {
          data: [],
          error: null,
        };

  if (unitError) {
    throw new Error(
      `Unable to load item units: ${unitError.message}`,
    );
  }

  const unitIds = [
    ...new Set(
      (itemUnits ?? []).map(
        (itemUnit) =>
          itemUnit.unit_id,
      ),
    ),
  ];

  const {
    data: units,
  } =
    unitIds.length > 0
      ? await supabase
          .from("units")
          .select(
            "id, code, name, symbol",
          )
          .in(
            "id",
            unitIds,
          )
      : {
          data: [],
        };

  const itemMap =
    new Map(
      (items ?? []).map(
        (item) => [
          item.id,
          item,
        ],
      ),
    );

  const unitMap =
    new Map(
      (units ?? []).map(
        (unit) => [
          unit.id,
          unit,
        ],
      ),
    );

  const draft =
    order.status === "DRAFT";

  const lineRows =
    (lines ?? []).map(
      (line) => {
        const item =
          itemMap.get(
            line.item_id,
          );

        const unit =
          unitMap.get(
            line.order_unit_id,
          );

        return {
          id: line.id,
          name:
            item?.name ??
            "สินค้าที่ปิดใช้งาน",
          sku: item?.sku ?? "",
          ordered: formatQuantity(
            line.ordered_quantity,
            unit?.symbol ?? "",
          ),
          received: formatQuantity(
            line.received_quantity,
            unit?.symbol ?? "",
          ),
          unitCost: formatUnitCost(
            line.unit_cost,
          ),
        };
      },
    );

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={
          <Link
            href="/purchase-orders"
            className="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
            ใบสั่งซื้อทั้งหมด
          </Link>
        }
        title={
          <span className="flex flex-wrap items-center gap-2">
            {order.po_number}
            <PurchaseOrderStatus
              status={order.status}
            />
          </span>
        }
        description={
          supplier?.name ??
          "ไม่ทราบผู้จำหน่าย"
        }
        actions={
          draft ? (
            <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto">
              <form
                action={
                  cancelPurchaseOrder
                }
              >
                <input
                  type="hidden"
                  name="purchase_order_id"
                  value={order.id}
                />
                <SubmitButton
                  variant="destructive"
                  className="w-full"
                  pendingLabel="กำลังยกเลิก..."
                >
                  <XCircle className="size-4" aria-hidden="true" />
                  ยกเลิก PO
                </SubmitButton>
              </form>

              <form
                action={
                  confirmPurchaseOrder
                }
              >
                <input
                  type="hidden"
                  name="purchase_order_id"
                  value={order.id}
                />
                <SubmitButton
                  disabled={
                    !lines?.length
                  }
                  className="w-full"
                  pendingLabel="กำลังยืนยัน..."
                >
                  <CheckCircle2 className="size-4" aria-hidden="true" />
                  ยืนยันสั่งซื้อ
                </SubmitButton>
              </form>
            </div>
          ) : null
        }
      />

      {messages.success ? (
        <Notice tone="success">{messages.success}</Notice>
      ) : null}

      {messages.error ? (
        <Notice tone="error">{messages.error}</Notice>
      ) : null}

      <dl className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border bg-card p-4 shadow-card">
          <dt className="text-sm text-muted-foreground">
            ผู้จำหน่าย
          </dt>
          <dd className="mt-1 font-semibold">
            {supplier?.name ?? "-"}
          </dd>
        </div>

        <div className="rounded-xl border bg-card p-4 shadow-card">
          <dt className="text-sm text-muted-foreground">
            วันที่คาดว่าจะได้รับ
          </dt>
          <dd className="mt-1 font-semibold">
            {order.expected_at
              ? formatDate(
                  order.expected_at,
                )
              : "-"}
          </dd>
        </div>

        <div className="rounded-xl border bg-card p-4 shadow-card">
          <dt className="text-sm text-muted-foreground">
            จำนวนรายการ
          </dt>
          <dd className="mt-1 font-semibold tabular-nums">
            {lines?.length ?? 0}
          </dd>
        </div>
      </dl>

      {order.notes ? (
        <Notice title="หมายเหตุ">
          {order.notes}
        </Notice>
      ) : null}

      {draft ? (
        <Panel aria-labelledby="po-add-title">
          <SectionHeader
            id="po-add-title"
            title="เพิ่มสินค้า"
            description="เพิ่มรายการให้ครบก่อนยืนยันใบสั่งซื้อ"
            icon={ListPlus}
          />

          {(items ?? []).length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">
              ยังไม่มีสินค้าในคลัง
            </p>
          ) : (
            <form
              action={
                addPurchaseOrderItem
              }
              className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4"
            >
              <input
                type="hidden"
                name="purchase_order_id"
                value={order.id}
              />

              <Field label="สินค้า" htmlFor="po-item" required>
                <NativeSelect
                  id="po-item"
                  name="item_id"
                  required
                  defaultValue=""
                >
                  <option
                    value=""
                    disabled
                  >
                    เลือกสินค้า
                  </option>
                  {(items ?? []).map(
                    (item) => (
                      <option
                        key={item.id}
                        value={item.id}
                      >
                        {item.name} ·{" "}
                        {item.sku}
                      </option>
                    ),
                  )}
                </NativeSelect>
              </Field>

              <Field
                label="หน่วย"
                htmlFor="po-unit"
                required
                hint="เลือกหน่วยที่ตรงกับสินค้าที่เลือก"
              >
                <NativeSelect
                  id="po-unit"
                  name="unit_id"
                  required
                  defaultValue=""
                >
                  <option
                    value=""
                    disabled
                  >
                    เลือกหน่วย
                  </option>
                  {(itemUnits ?? []).map(
                    (itemUnit) => {
                      const item =
                        itemMap.get(
                          itemUnit.item_id,
                        );

                      const unit =
                        unitMap.get(
                          itemUnit.unit_id,
                        );

                      if (
                        !item ||
                        !unit
                      ) {
                        return null;
                      }

                      return (
                        <option
                          key={`${itemUnit.item_id}-${itemUnit.unit_id}`}
                          value={
                            itemUnit.unit_id
                          }
                        >
                          {item.name} ·{" "}
                          {unit.name} (
                          {unit.symbol})
                        </option>
                      );
                    },
                  )}
                </NativeSelect>
              </Field>

              <Field label="จำนวน" htmlFor="po-quantity" required>
                <Input
                  id="po-quantity"
                  type="number"
                  name="quantity"
                  inputMode="decimal"
                  min="0.0001"
                  step="0.0001"
                  required
                  placeholder="5000"
                />
              </Field>

              <Field label="ราคาต่อหน่วย" htmlFor="po-cost" hint="ไม่บังคับ">
                <Input
                  id="po-cost"
                  type="number"
                  name="unit_cost"
                  inputMode="decimal"
                  min="0"
                  step="0.0001"
                  placeholder="0.00"
                />
              </Field>

              <div className="md:col-span-2 xl:col-span-4">
                <SubmitButton className="w-full sm:w-auto">
                  <PackagePlus className="size-4" aria-hidden="true" />
                  เพิ่มรายการ
                </SubmitButton>
              </div>
            </form>
          )}
        </Panel>
      ) : null}

      <ReceivingSection
        purchaseOrderId={order.id}
        status={order.status}
      />

      <Panel aria-labelledby="po-lines-title">
        <SectionHeader
          id="po-lines-title"
          title="รายการสินค้า"
          description="จำนวนที่สั่งซื้อและจำนวนที่รับแล้ว"
          icon={ShoppingCart}
        />

        {lineRows.length === 0 ? (
          <EmptyState
            className="mt-4"
            icon={ShoppingCart}
            title="ยังไม่มีสินค้าในใบสั่งซื้อ"
            description={
              draft
                ? "เพิ่มสินค้าจากแบบฟอร์มด้านบน"
                : undefined
            }
          />
        ) : (
          <>
            <ul className="mt-4 divide-y rounded-xl border lg:hidden">
              {lineRows.map((line) => (
                <li
                  key={line.id}
                  className="flex items-start justify-between gap-3 px-4 py-3.5"
                >
                  <div className="min-w-0">
                    <p className="font-medium">{line.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {line.sku}
                    </p>
                    <dl className="mt-2 grid grid-cols-3 gap-2 text-sm">
                      <div>
                        <dt className="text-xs text-muted-foreground">สั่ง</dt>
                        <dd className="font-semibold tabular-nums">{line.ordered}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted-foreground">รับแล้ว</dt>
                        <dd className="font-semibold tabular-nums">{line.received}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted-foreground">ราคา/หน่วย</dt>
                        <dd className="tabular-nums">{line.unitCost}</dd>
                      </div>
                    </dl>
                  </div>

                  {draft ? (
                    <DeleteLine
                      orderId={order.id}
                      lineId={line.id}
                      name={line.name}
                    />
                  ) : null}
                </li>
              ))}
            </ul>

            <div className="mt-4 hidden overflow-hidden rounded-xl border lg:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>สินค้า</TableHead>
                    <TableHead className="text-right">จำนวนสั่ง</TableHead>
                    <TableHead className="text-right">รับแล้ว</TableHead>
                    <TableHead className="text-right">ราคาต่อหน่วย</TableHead>
                    {draft ? (
                      <TableHead className="text-right">
                        จัดการ
                      </TableHead>
                    ) : null}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lineRows.map((line) => (
                    <TableRow key={line.id}>
                      <TableCell className="whitespace-normal">
                        <p className="font-medium">{line.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {line.sku}
                        </p>
                      </TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">
                        {line.ordered}
                      </TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">
                        {line.received}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {line.unitCost}
                      </TableCell>
                      {draft ? (
                        <TableCell className="text-right">
                          <div className="flex justify-end">
                            <DeleteLine
                              orderId={order.id}
                              lineId={line.id}
                              name={line.name}
                            />
                          </div>
                        </TableCell>
                      ) : null}
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
