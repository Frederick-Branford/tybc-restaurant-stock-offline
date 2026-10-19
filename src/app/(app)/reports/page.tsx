import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import {
  BarChart3,
  Boxes,
  Building2,
  ChevronDown,
  ClipboardList,
  Cloud,
  ShoppingCart,
  Trash2,
  TriangleAlert,
} from "lucide-react";

import { AiSummaryCard } from "@/components/ai-summary-card";
import { MetricCard } from "@/components/app/metric-card";
import { Notice } from "@/components/app/notice";
import {
  PageHeader,
  Panel,
  SectionHeader,
} from "@/components/app/page-header";
import { PurchaseOrderStatus } from "@/components/app/po-status";
import {
  RecordItem,
  RecordList,
} from "@/components/app/record-list";
import { StockStatusBadge } from "@/components/app/stock-status-badge";
import { LocalAiSummaryCard } from "@/components/local-ai-summary-card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { LocalAiAvailability } from "@/lib/ai/local/ui-view";
import { readLocalAiConfig } from "@/lib/ai/providers/ollama";
import { stockLevel } from "@/lib/ui/stock-level";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "รายงาน",
};

type InventoryRow = {
  item_id: string;
  sku: string;
  name: string;
  base_unit_symbol: string;
  current_quantity: number | string;
  minimum_stock: number | string;
  reorder_point: number | string;
  stock_status: string;
  below_minimum: boolean;
  is_active: boolean;
};

type MovementRow = {
  id: string;
  item_id: string;
  movement_type: string;
  base_quantity: number | string;
  reason_code: string | null;
  occurred_at: string;
};

type WasteRow = {
  id: string;
  item_id: string;
  base_quantity: number | string;
  stock_movement_id: string;
  occurred_at: string;
};

type PurchaseOrderRow = {
  id: string;
  supplier_id: string;
  po_number: string;
  status: string;
  created_at: string;
};

type PurchaseOrderItemRow = {
  purchase_order_id: string;
  item_id: string;
  ordered_quantity: number | string;
  received_quantity: number | string;
  unit_cost: number | string | null;
};

type SupplierRow = {
  id: string;
  name: string;
};

type ReceiptRow = {
  id: string;
  purchase_order_id: string;
  received_at: string;
};

const movementLabels: Record<string, string> = {
  OPENING_BALANCE: "ยอดยกมา",
  STOCK_IN: "รับสินค้าเข้า",
  STOCK_OUT: "เบิกสินค้า",
  WASTE: "ของเสีย",
  COUNT_ADJUSTMENT: "ปรับจากนับสต็อก",
  MANUAL_ADJUSTMENT: "ปรับยอดด้วยมือ",
  PO_RECEIVE: "รับจากใบสั่งซื้อ",
  POS_DEDUCTION: "ตัดจาก POS",
  RETURN_IN: "รับคืนเข้า",
  RETURN_OUT: "ส่งคืนออก",
};

const poStatusLabels: Record<string, string> = {
  DRAFT: "แบบร่าง",
  ORDERED: "สั่งซื้อแล้ว",
  PARTIALLY_RECEIVED: "รับบางส่วน",
  RECEIVED: "รับครบแล้ว",
  CANCELLED: "ยกเลิก",
};

const wasteReasonLabels: Record<string, string> = {
  EXPIRED: "หมดอายุ",
  SPOILED: "เน่าเสีย / เสีย",
  DAMAGED: "ชำรุด",
  PREP_LOSS: "สูญเสียระหว่างเตรียม",
  OVERPRODUCTION: "ผลิตเกิน",
  SPILLAGE: "หก / รั่ว",
  OTHER: "อื่น ๆ",
};

function number(value: number | string | null | undefined) {
  return Number(value ?? 0);
}

function formatQuantity(value: number | string) {
  return number(value).toLocaleString("th-TH", {
    maximumFractionDigits: 4,
  });
}

function formatMoney(value: number) {
  return value.toLocaleString("th-TH", {
    style: "currency",
    currency: "THB",
    minimumFractionDigits: 2,
  });
}

function ReportsLoading() {
  return (
    <div className="space-y-6">
      <div className="h-16 animate-pulse rounded-xl bg-muted/40" />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div
            key={index}
            className="h-28 animate-pulse rounded-2xl border bg-muted/40"
          />
        ))}
      </div>

      <div className="h-80 animate-pulse rounded-2xl border bg-muted/40" />
    </div>
  );
}

// Read at request time (after connection()). Mirrors the Local AI route's
// first check, so the card can explain up front when Local AI is off.
function getLocalAiAvailability(): LocalAiAvailability {
  const config = readLocalAiConfig();

  if (config.ok) {
    return "enabled";
  }

  return config.error.code === "LOCAL_AI_DISABLED"
    ? "disabled"
    : "misconfigured";
}

export default function ReportsPage() {
  return (
    <Suspense fallback={<ReportsLoading />}>
      <ReportsContent />
    </Suspense>
  );
}

async function ReportsContent() {
  await connection();

  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    redirect("/login");
  }

  const admin = createAdminClient();

  const {
    data: allowed,
    error: permissionError,
  } = await admin.rpc(
    "user_has_permission",
    {
      p_user_id: user.id,
      requested_permission: "reports.view",
    },
  );

  if (permissionError) {
    throw new Error(
      `Permission check failed: ${permissionError.message}`,
    );
  }

  if (!allowed) {
    redirect("/dashboard");
  }

  const [
    inventoryResult,
    movementResult,
    wasteResult,
    orderResult,
    orderItemResult,
    supplierResult,
    receiptResult,
  ] = await Promise.all([
    admin
      .from("inventory_balances")
      .select(
        "item_id, sku, name, base_unit_symbol, current_quantity, minimum_stock, reorder_point, stock_status, below_minimum, is_active",
      )
      .eq("is_active", true)
      .order("name"),

    admin
      .from("stock_movements")
      .select(
        "id, item_id, movement_type, base_quantity, reason_code, occurred_at",
      )
      .order("occurred_at", {
        ascending: false,
      }),

    admin
      .from("waste_records")
      .select(
        "id, item_id, base_quantity, stock_movement_id, occurred_at",
      )
      .order("occurred_at", {
        ascending: false,
      }),

    admin
      .from("purchase_orders")
      .select(
        "id, supplier_id, po_number, status, created_at",
      )
      .order("created_at", {
        ascending: false,
      }),

    admin
      .from("purchase_order_items")
      .select(
        "purchase_order_id, item_id, ordered_quantity, received_quantity, unit_cost",
      ),

    admin
      .from("suppliers")
      .select("id, name"),

    admin
      .from("purchase_receipts")
      .select(
        "id, purchase_order_id, received_at",
      ),
  ]);

  const failures = [
    inventoryResult.error,
    movementResult.error,
    wasteResult.error,
    orderResult.error,
    orderItemResult.error,
    supplierResult.error,
    receiptResult.error,
  ].filter(Boolean);

  if (failures.length > 0) {
    throw new Error(
      failures
        .map((failure) => failure?.message)
        .filter(Boolean)
        .join(" | "),
    );
  }

  const inventory =
    (inventoryResult.data ?? []) as InventoryRow[];

  const movements =
    (movementResult.data ?? []) as MovementRow[];

  const wasteRecords =
    (wasteResult.data ?? []) as WasteRow[];

  const purchaseOrders =
    (orderResult.data ?? []) as PurchaseOrderRow[];

  const purchaseOrderItems =
    (orderItemResult.data ?? []) as PurchaseOrderItemRow[];

  const suppliers =
    (supplierResult.data ?? []) as SupplierRow[];

  const receipts =
    (receiptResult.data ?? []) as ReceiptRow[];

  const itemMap = new Map(
    inventory.map((item) => [
      item.item_id,
      item,
    ]),
  );

  const movementMap = new Map(
    movements.map((movement) => [
      movement.id,
      movement,
    ]),
  );

  const orderMap = new Map(
    purchaseOrders.map((order) => [
      order.id,
      order,
    ]),
  );

  const supplierMap = new Map(
    suppliers.map((supplier) => [
      supplier.id,
      supplier.name,
    ]),
  );

  const lowStockItems =
    inventory.filter(
      (item) =>
        item.stock_status === "LOW_STOCK" ||
        item.stock_status === "OUT_OF_STOCK",
    );

  const movementCounts = new Map<string, number>();

  for (const movement of movements) {
    movementCounts.set(
      movement.movement_type,
      (movementCounts.get(movement.movement_type) ?? 0) + 1,
    );
  }

  const wasteByReason = new Map<
    string,
    {
      events: number;
      items: Map<
        string,
        number
      >;
    }
  >();

  for (const waste of wasteRecords) {
    const movement =
      movementMap.get(
        waste.stock_movement_id,
      );

    const reason =
      movement?.reason_code ??
      "OTHER";

    const current =
      wasteByReason.get(reason) ?? {
        events: 0,
        items: new Map<string, number>(),
      };

    current.events += 1;

    current.items.set(
      waste.item_id,
      (current.items.get(waste.item_id) ?? 0) +
        number(waste.base_quantity),
    );

    wasteByReason.set(
      reason,
      current,
    );
  }

  const poStatusCounts =
    new Map<string, number>();

  for (const order of purchaseOrders) {
    poStatusCounts.set(
      order.status,
      (poStatusCounts.get(order.status) ?? 0) + 1,
    );
  }

  let orderedPurchaseValue = 0;
  let receivedPurchaseValue = 0;
  let missingCostLines = 0;

  const supplierPoCounts =
    new Map<string, number>();

  for (const order of purchaseOrders) {
    if (order.status === "CANCELLED") {
      continue;
    }

    supplierPoCounts.set(
      order.supplier_id,
      (supplierPoCounts.get(order.supplier_id) ?? 0) + 1,
    );
  }

  for (const line of purchaseOrderItems) {
    const order =
      orderMap.get(
        line.purchase_order_id,
      );

    if (
      !order ||
      order.status === "CANCELLED" ||
      order.status === "DRAFT"
    ) {
      continue;
    }

    if (line.unit_cost === null) {
      missingCostLines += 1;
      continue;
    }

    const unitCost =
      number(line.unit_cost);

    orderedPurchaseValue +=
      number(line.ordered_quantity) *
      unitCost;

    receivedPurchaseValue +=
      number(line.received_quantity) *
      unitCost;
  }

  const supplierSummary =
    [...supplierPoCounts.entries()]
      .map(
        ([supplierId, count]) => ({
          supplierId,
          name:
            supplierMap.get(supplierId) ??
            "ไม่ทราบผู้จำหน่าย",
          count,
        }),
      )
      .sort(
        (a, b) =>
          b.count - a.count,
      );

  return (
    <div className="space-y-6 md:space-y-8">
      <PageHeader
        icon={BarChart3}
        title="รายงาน"
        description="ภาพรวม Stock การเคลื่อนไหว ของเสีย และการจัดซื้อจากข้อมูลจริงของระบบ"
      />

      <div className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-4">
        <MetricCard
          label="สินค้าในคลัง"
          value={inventory.length}
          unit="รายการ"
          icon={Boxes}
          tone="brand"
        />
        <MetricCard
          label="ใกล้หมด / หมด"
          value={lowStockItems.length}
          unit="รายการ"
          icon={TriangleAlert}
          tone={lowStockItems.length > 0 ? "danger" : "success"}
        />
        <MetricCard
          label="การเคลื่อนไหว"
          value={movements.length}
          unit="ครั้ง"
          icon={ClipboardList}
        />
        <MetricCard
          label="เหตุการณ์ของเสีย"
          value={wasteRecords.length}
          unit="ครั้ง"
          icon={Trash2}
          tone={wasteRecords.length > 0 ? "danger" : "neutral"}
        />
      </div>

      <section aria-labelledby="ai-section-title" className="space-y-3">
        <SectionHeader
          id="ai-section-title"
          title="AI ช่วยสรุปร้าน"
          description="ตัวเลขจริงมาจากระบบ AI ช่วยอ่านและสรุปเท่านั้น"
        />

        <LocalAiSummaryCard
          availability={getLocalAiAvailability()}
        />

        {/* Cloud AI is an explicit, separate user action. Local AI never
            falls back to it automatically. */}
        <details className="group rounded-xl border bg-card shadow-card">
          <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 rounded-xl px-4 py-3 text-sm font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/40 md:px-5 [&::-webkit-details-marker]:hidden">
            <span className="flex min-w-0 items-center gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface-muted text-muted-foreground">
                <Cloud className="size-[1.125rem]" aria-hidden="true" />
              </span>
              <span className="min-w-0 break-words">
                Cloud AI (OpenAI) · ใช้เมื่อเลือกเองเท่านั้น
              </span>
            </span>
            <ChevronDown
              className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
              aria-hidden="true"
            />
          </summary>

          <div className="space-y-3 border-t p-4 md:p-5">
            <Notice tone="info">
              ส่วนนี้จะส่งข้อมูลสรุปของร้านไปวิเคราะห์ที่ OpenAI
              เมื่อกดปุ่มด้านล่างเท่านั้น
              ระบบไม่สลับจาก Local AI มาใช้ Cloud AI โดยอัตโนมัติ
            </Notice>

            <AiSummaryCard />
          </div>
        </details>
      </section>

      <Panel aria-labelledby="stock-report-title">
        <SectionHeader
          id="stock-report-title"
          title="รายงาน Stock ปัจจุบัน"
          description="ยอดคงเหลือเทียบกับขั้นต่ำและจุดสั่งซื้อ"
          icon={Boxes}
        />

        <RecordList
          className="mt-4 lg:hidden"
          label="รายงาน Stock ปัจจุบัน"
        >
          {inventory.map((item) => (
            <RecordItem
              key={item.item_id}
              title={item.name}
              subtitle={item.sku}
              meta={`ขั้นต่ำ ${formatQuantity(item.minimum_stock)} · จุดสั่งซื้อ ${formatQuantity(item.reorder_point)} ${item.base_unit_symbol}`}
              value={`${formatQuantity(item.current_quantity)} ${item.base_unit_symbol}`}
              aside={
                <StockStatusBadge
                  level={stockLevel(
                    item.stock_status,
                    item.below_minimum,
                  )}
                />
              }
            />
          ))}
        </RecordList>

        <div className="mt-4 hidden overflow-hidden rounded-xl border lg:block">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>สินค้า</TableHead>
                <TableHead className="text-right">คงเหลือ</TableHead>
                <TableHead className="text-right">ขั้นต่ำ</TableHead>
                <TableHead className="text-right">จุดสั่งซื้อ</TableHead>
                <TableHead>สถานะ</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {inventory.map((item) => (
                <TableRow key={item.item_id}>
                  <TableCell className="whitespace-normal">
                    <p className="font-medium">{item.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {item.sku}
                    </p>
                  </TableCell>
                  <TableCell className="text-right text-base font-semibold tabular-nums">
                    {formatQuantity(
                      item.current_quantity,
                    )}{" "}
                    {item.base_unit_symbol}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatQuantity(
                      item.minimum_stock,
                    )}{" "}
                    {item.base_unit_symbol}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatQuantity(
                      item.reorder_point,
                    )}{" "}
                    {item.base_unit_symbol}
                  </TableCell>
                  <TableCell>
                    <StockStatusBadge
                      level={stockLevel(
                        item.stock_status,
                        item.below_minimum,
                      )}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <Notice tone="info" className="mt-4">
          ยังไม่แสดงมูลค่า Stock
          จนกว่าจะกำหนดวิธีคิดต้นทุน เช่น
          Moving Average หรือ FIFO
        </Notice>
      </Panel>

      <div className="grid items-start gap-6 xl:grid-cols-2">
        <Panel aria-labelledby="movement-summary-title">
          <SectionHeader
            id="movement-summary-title"
            title="สรุปการเคลื่อนไหว"
            description="จำนวนครั้งตามประเภท"
            icon={ClipboardList}
          />

          <ul className="mt-4 divide-y rounded-xl border">
            {Object.entries(
              movementLabels,
            ).map(
              ([type, label]) => {
                const count =
                  movementCounts.get(type) ??
                  0;

                if (count === 0) {
                  return null;
                }

                return (
                  <li
                    key={type}
                    className="flex items-center justify-between gap-3 px-4 py-3"
                  >
                    <span className="text-sm">
                      {label}
                    </span>
                    <span className="font-semibold tabular-nums">
                      {count} ครั้ง
                    </span>
                  </li>
                );
              },
            )}
          </ul>

          <p className="mt-3 text-xs text-muted-foreground">
            แสดงจำนวนเหตุการณ์ ไม่รวมปริมาณข้ามสินค้า
            เพราะแต่ละสินค้าอาจใช้หน่วยต่างกัน
          </p>
        </Panel>

        <Panel aria-labelledby="waste-summary-title">
          <SectionHeader
            id="waste-summary-title"
            title="สรุปของเสีย"
            description="แยกตามสาเหตุ"
            icon={Trash2}
          />

          {wasteByReason.size === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">
              ยังไม่มีข้อมูลของเสีย
            </p>
          ) : (
            <ul className="mt-4 grid gap-3">
              {[...wasteByReason.entries()].map(
                ([reason, summary]) => (
                  <li
                    key={reason}
                    className="rounded-xl border p-3"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-medium">
                        {wasteReasonLabels[
                          reason
                        ] ?? reason}
                      </p>
                      <span className="rounded-full bg-danger-soft px-2.5 py-0.5 text-xs font-semibold text-danger">
                        {summary.events} ครั้ง
                      </span>
                    </div>

                    <ul className="mt-2 space-y-1">
                      {[...summary.items.entries()].map(
                        ([itemId, quantity]) => {
                          const item =
                            itemMap.get(itemId);

                          return (
                            <li
                              key={itemId}
                              className="flex justify-between gap-3 text-sm text-muted-foreground"
                            >
                              <span>
                                {item?.name ??
                                  "ไม่ทราบสินค้า"}
                              </span>
                              <span className="font-medium text-foreground tabular-nums">
                                {formatQuantity(
                                  quantity,
                                )}{" "}
                                {
                                  item?.base_unit_symbol
                                }
                              </span>
                            </li>
                          );
                        },
                      )}
                    </ul>
                  </li>
                ),
              )}
            </ul>
          )}
        </Panel>
      </div>

      <Panel aria-labelledby="purchasing-report-title">
        <SectionHeader
          id="purchasing-report-title"
          title="รายงานจัดซื้อ"
          description="ใบสั่งซื้อ การรับสินค้า และมูลค่าจัดซื้อ"
          icon={ShoppingCart}
        />

        <dl className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            {
              label: "ใบสั่งซื้อทั้งหมด",
              value: purchaseOrders.length,
            },
            {
              label: "ใบรับสินค้า",
              value: receipts.length,
            },
            {
              label: "มูลค่าสั่งซื้อ",
              value: formatMoney(
                orderedPurchaseValue,
              ),
            },
            {
              label: "มูลค่าที่รับแล้ว",
              value: formatMoney(
                receivedPurchaseValue,
              ),
            },
          ].map((stat) => (
            <div
              key={stat.label}
              className="rounded-xl bg-surface-warm p-4"
            >
              <dt className="text-sm text-muted-foreground">
                {stat.label}
              </dt>
              <dd className="mt-1 text-xl font-semibold break-words tabular-nums md:text-2xl">
                {stat.value}
              </dd>
            </div>
          ))}
        </dl>

        <div className="mt-5 grid gap-5 xl:grid-cols-2">
          <div>
            <h3 className="mb-2 text-sm font-semibold">
              สถานะ PO
            </h3>
            <ul className="divide-y rounded-xl border">
              {Object.keys(
                poStatusLabels,
              ).map(
                (status) => (
                  <li
                    key={status}
                    className="flex items-center justify-between gap-3 px-4 py-2.5"
                  >
                    <PurchaseOrderStatus status={status} />
                    <span className="font-semibold tabular-nums">
                      {poStatusCounts.get(
                        status,
                      ) ?? 0}
                    </span>
                  </li>
                ),
              )}
            </ul>
          </div>

          <div>
            <h3 className="mb-2 text-sm font-semibold">
              ผู้จำหน่ายตามจำนวน PO
            </h3>
            {supplierSummary.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                ยังไม่มีข้อมูล
              </p>
            ) : (
              <ul className="divide-y rounded-xl border">
                {supplierSummary.map(
                  (supplier) => (
                    <li
                      key={supplier.supplierId}
                      className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm"
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <Building2 className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                        <span className="truncate">
                          {supplier.name}
                        </span>
                      </span>
                      <span className="font-semibold tabular-nums">
                        {supplier.count} PO
                      </span>
                    </li>
                  ),
                )}
              </ul>
            )}
          </div>
        </div>

        {missingCostLines > 0 ? (
          <Notice tone="warning" className="mt-4">
            มี {missingCostLines} รายการใน PO
            ที่ยังไม่มีราคาต่อหน่วย
            จึงไม่ถูกนำมาคำนวณมูลค่าจัดซื้อ
          </Notice>
        ) : null}
      </Panel>

      <Notice tone="info" title="ขอบเขตรายงาน">
        รายงานนี้ใช้ข้อมูลการเคลื่อนไหวของ Stock และการจัดซื้อที่ยืนยันแล้ว
        และยังไม่คำนวณมูลค่า Stock จนกว่าจะกำหนดวิธีคิดต้นทุนอย่างเป็นทางการ
      </Notice>
    </div>
  );
}
