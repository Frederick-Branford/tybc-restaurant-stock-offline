import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUpFromLine,
  Boxes,
  ClipboardList,
  Cpu,
  History,
  PackageCheck,
  Trash2,
  Truck,
} from "lucide-react";

import { BrandPattern } from "@/components/app/brand-pattern";
import { EmptyState } from "@/components/app/empty-state";
import { MetricCard } from "@/components/app/metric-card";
import {
  OperationalAlert,
  type AttentionItem,
} from "@/components/app/operational-alert";
import {
  PageHeader,
  Panel,
  SectionHeader,
} from "@/components/app/page-header";
import {
  RecordItem,
  RecordList,
} from "@/components/app/record-list";
import { stockLevelIcon } from "@/components/app/stock-status-badge";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  formatCount,
  formatQuantity,
  formatActivityTime,
  formatSignedQuantity,
  toNumber,
} from "@/lib/ui/format";
import {
  STOCK_LEVEL_LABELS,
  STOCK_LEVELS,
  stockLevel,
  stockLevelSeverity,
  type StockLevel,
} from "@/lib/ui/stock-level";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "หน้าแรก",
};

function getBangkokDayRange() {
  const parts =
    new Intl.DateTimeFormat(
      "en-CA",
      {
        timeZone: "Asia/Bangkok",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      },
    ).formatToParts(
      new Date(),
    );

  const values = Object.fromEntries(
    parts.map((part) => [
      part.type,
      part.value,
    ]),
  );

  const date =
    `${values.year}-${values.month}-${values.day}`;

  return {
    start:
      new Date(
        `${date}T00:00:00+07:00`,
      ).toISOString(),

    end:
      new Date(
        `${date}T23:59:59.999+07:00`,
      ).toISOString(),
  };
}

function movementLabel(
  type: string,
) {
  const labels: Record<
    string,
    string
  > = {
    OPENING_BALANCE:
      "ยอดยกมา",

    STOCK_IN:
      "รับสินค้าเข้า",

    STOCK_OUT:
      "เบิกสินค้า",

    WASTE:
      "ของเสีย",

    COUNT_ADJUSTMENT:
      "ตรวจนับสต็อก",

    MANUAL_ADJUSTMENT:
      "ปรับสต็อก",

    PO_RECEIVE:
      "รับสินค้าจาก PO",

    POS_DEDUCTION:
      "ตัดจาก POS",

    RETURN_IN:
      "รับคืน",

    RETURN_OUT:
      "คืนสินค้า",
  };

  return labels[type] ?? "รายการสต็อก";
}

const LEVEL_BAR: Record<StockLevel, string> = {
  NORMAL: "bg-success",
  NEAR_REORDER: "bg-warning",
  BELOW_MINIMUM: "bg-danger",
  OUT_OF_STOCK: "bg-critical",
};

const LEVEL_TEXT: Record<StockLevel, string> = {
  NORMAL: "text-success",
  NEAR_REORDER: "text-warning",
  BELOW_MINIMUM: "text-danger",
  OUT_OF_STOCK: "text-critical",
};

// Inbound movements shown as "รับเข้า" on the dashboard.
const RECEIVING_TYPES = [
  "STOCK_IN",
  "PO_RECEIVE",
];

// Purchase orders that still expect deliveries.
const OPEN_PO_STATUSES = [
  "ORDERED",
  "PARTIALLY_RECEIVED",
];

async function DashboardContent() {
  await connection();

  const supabase =
    await createClient();

  const {
    start,
    end,
  } = getBangkokDayRange();

  // Read-only queries. The last three are counts for the "วันนี้" section.
  const [
    itemsResult,
    balancesResult,
    todayWasteResult,
    recentMovementsResult,
    unitsResult,
    todayReceivingResult,
    todayStockOutResult,
    openPurchaseOrdersResult,
  ] = await Promise.all([
    supabase
      .from("items")
      .select(
        "id, sku, name, reorder_point, minimum_stock",
      )
      .eq("is_active", true)
      .order("name"),

    supabase
      .from("inventory_balances")
      .select(
        "item_id, current_quantity, base_unit_symbol, stock_status, below_minimum",
      ),

    supabase
      .from("waste_records")
      .select(
        "id",
        {
          count: "exact",
          head: true,
        },
      )
      .gte(
        "occurred_at",
        start,
      )
      .lte(
        "occurred_at",
        end,
      ),

    supabase
      .from("stock_movements")
      .select(
        "id, item_id, movement_type, base_unit_id, base_quantity, reason_code, note, occurred_at",
      )
      .order(
        "occurred_at",
        {
          ascending: false,
        },
      )
      .limit(8),

    supabase
      .from("units")
      .select(
        "id, code, symbol",
      ),

    supabase
      .from("stock_movements")
      .select(
        "id",
        {
          count: "exact",
          head: true,
        },
      )
      .in(
        "movement_type",
        RECEIVING_TYPES,
      )
      .gte(
        "occurred_at",
        start,
      )
      .lte(
        "occurred_at",
        end,
      ),

    supabase
      .from("stock_movements")
      .select(
        "id",
        {
          count: "exact",
          head: true,
        },
      )
      .eq(
        "movement_type",
        "STOCK_OUT",
      )
      .gte(
        "occurred_at",
        start,
      )
      .lte(
        "occurred_at",
        end,
      ),

    supabase
      .from("purchase_orders")
      .select(
        "id",
        {
          count: "exact",
          head: true,
        },
      )
      .in(
        "status",
        OPEN_PO_STATUSES,
      ),
  ]);

  if (
    itemsResult.error ||
    balancesResult.error ||
    todayWasteResult.error ||
    recentMovementsResult.error ||
    unitsResult.error ||
    todayReceivingResult.error ||
    todayStockOutResult.error ||
    openPurchaseOrdersResult.error
  ) {
    throw new Error(
      "Unable to load Dashboard.",
    );
  }

  const items =
    itemsResult.data ?? [];

  const balances =
    balancesResult.data ?? [];

  const recentMovements =
    recentMovementsResult.data ?? [];

  const units =
    unitsResult.data ?? [];

  const balanceByItem =
    new Map(
      balances.map(
        (balance) => [
          balance.item_id,
          balance,
        ],
      ),
    );

  const itemById =
    new Map(
      items.map(
        (item) => [
          item.id,
          item,
        ],
      ),
    );

  const unitById =
    new Map(
      units.map(
        (unit) => [
          unit.id,
          unit,
        ],
      ),
    );

  // Same facts as before: an item without a balance row counts as out of
  // stock. The level only adds below_minimum for display.
  const stockRows =
    items.map((item) => {
      const balance =
        balanceByItem.get(
          item.id,
        );

      const currentQuantity =
        toNumber(
          balance?.current_quantity,
        );

      const symbol =
        balance?.base_unit_symbol ??
        "";

      return {
        ...item,
        currentQuantity,
        symbol,
        level: stockLevel(
          balance?.stock_status ??
            "OUT_OF_STOCK",
          balance?.below_minimum,
        ),
      };
    });

  const levelCounts =
    Object.fromEntries(
      STOCK_LEVELS.map((level) => [
        level,
        stockRows.filter(
          (row) =>
            row.level === level,
        ).length,
      ]),
    ) as Record<StockLevel, number>;

  const attentionItems: AttentionItem[] =
    stockRows
      .filter(
        (row) =>
          row.level !== "NORMAL",
      )
      .sort(
        (a, b) =>
          stockLevelSeverity(a.level) -
            stockLevelSeverity(b.level) ||
          a.currentQuantity -
            b.currentQuantity,
      )
      .map((row) => {
        const reorderPoint =
          toNumber(row.reorder_point);

        const minimumStock =
          toNumber(row.minimum_stock);

        const detail =
          row.level ===
          "BELOW_MINIMUM"
            ? `ขั้นต่ำ ${formatQuantity(minimumStock, row.symbol)} · จุดสั่งซื้อ ${formatQuantity(reorderPoint, row.symbol)}`
            : `จุดสั่งซื้อ ${formatQuantity(reorderPoint, row.symbol)}`;

        return {
          id: row.id,
          name: row.name,
          quantity:
            formatQuantity(
              row.currentQuantity,
              row.symbol,
            ),
          level: row.level,
          detail,
        };
      });

  const wasteTodayCount =
    todayWasteResult.count ??
    0;

  const receivingTodayCount =
    todayReceivingResult.count ??
    0;

  const stockOutTodayCount =
    todayStockOutResult.count ??
    0;

  const openPurchaseOrderCount =
    openPurchaseOrdersResult.count ??
    0;

  const totalItems =
    stockRows.length;

  return (
    <div className="space-y-6 md:space-y-8">
      <PageHeader
        title="ภาพรวมร้านวันนี้"
        description="สถานะ Stock และงานที่ต้องดูแลของร้าน"
      />

      {/* 1. ต้องตรวจสอบ */}
      <OperationalAlert
        counts={{
          OUT_OF_STOCK:
            levelCounts.OUT_OF_STOCK,
          BELOW_MINIMUM:
            levelCounts.BELOW_MINIMUM,
          NEAR_REORDER:
            levelCounts.NEAR_REORDER,
        }}
        items={attentionItems}
        href="/inventory"
      />

      {/* 2. วันนี้ */}
      <section aria-labelledby="today-title" className="space-y-3">
        <SectionHeader
          id="today-title"
          title="วันนี้"
          description="นับจากเที่ยงคืนตามเวลาไทย"
        />

        <div className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-4">
          <MetricCard
            label="ของเสียวันนี้"
            value={formatCount(wasteTodayCount)}
            unit="รายการ"
            icon={Trash2}
            tone={wasteTodayCount > 0 ? "danger" : "neutral"}
            hint="ดูรายการของเสีย"
            href="/waste"
          />

          <MetricCard
            label="รับเข้าวันนี้"
            value={formatCount(receivingTodayCount)}
            unit="รายการ"
            icon={ArrowDownToLine}
            tone="success"
            hint="รวมรับจากใบสั่งซื้อ"
            href="/stock-in"
          />

          <MetricCard
            label="เบิกออกวันนี้"
            value={formatCount(stockOutTodayCount)}
            unit="รายการ"
            icon={ArrowUpFromLine}
            tone="brand"
            hint="ดูการเบิกสินค้า"
            href="/stock-out"
          />

          <MetricCard
            label="PO รอรับสินค้า"
            value={formatCount(openPurchaseOrderCount)}
            unit="ใบ"
            icon={Truck}
            tone={openPurchaseOrderCount > 0 ? "warning" : "neutral"}
            hint="ดูใบสั่งซื้อ"
            href="/purchase-orders"
          />
        </div>
      </section>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        {/* 3. Stock overview */}
        <Panel aria-labelledby="overview-title">
          <SectionHeader
            id="overview-title"
            title="ภาพรวม Stock"
            description={`สินค้าที่ใช้งาน ${formatCount(totalItems)} รายการ`}
            icon={Boxes}
          />

          {totalItems === 0 ? (
            <EmptyState
              className="mt-4"
              icon={Boxes}
              title="ยังไม่มีสินค้าในคลัง"
              description="เพิ่มรายการแรกได้ที่หน้าคลังสินค้า"
            />
          ) : (
            <>
              <div
                role="img"
                aria-label={STOCK_LEVELS.map(
                  (level) =>
                    `${STOCK_LEVEL_LABELS[level]} ${levelCounts[level]} รายการ`,
                ).join(", ")}
                className="mt-5 flex h-3 overflow-hidden rounded-full bg-surface-muted"
              >
                {[...STOCK_LEVELS]
                  .reverse()
                  .map((level) =>
                    levelCounts[level] > 0 ? (
                      <span
                        key={level}
                        className={cn("h-full", LEVEL_BAR[level])}
                        style={{
                          width: `${(levelCounts[level] / totalItems) * 100}%`,
                        }}
                      />
                    ) : null,
                  )}
              </div>

              <ul className="mt-4 grid grid-cols-2 gap-2">
                {[...STOCK_LEVELS].reverse().map((level) => {
                  const Icon = stockLevelIcon(level);

                  return (
                    <li
                      key={level}
                      className="flex items-center justify-between gap-2 rounded-lg bg-surface-warm px-3 py-2.5"
                    >
                      <span className="flex min-w-0 items-center gap-2 text-sm text-foreground">
                        <Icon
                          className={cn("size-4 shrink-0", LEVEL_TEXT[level])}
                          aria-hidden="true"
                        />
                        <span className="truncate">
                          {STOCK_LEVEL_LABELS[level]}
                        </span>
                      </span>
                      <span className="text-lg font-semibold tabular-nums">
                        {formatCount(levelCounts[level])}
                      </span>
                    </li>
                  );
                })}
              </ul>

              <Link
                href="/inventory"
                className={cn(
                  buttonVariants({ variant: "outline" }),
                  "mt-4 w-full sm:w-auto",
                )}
              >
                ดูคลังสินค้าทั้งหมด
              </Link>
            </>
          )}
        </Panel>

        {/* 4. Recent activity */}
        <Panel aria-labelledby="recent-title">
          <SectionHeader
            id="recent-title"
            title="ความเคลื่อนไหวล่าสุด"
            description="การเปลี่ยนแปลง Stock ล่าสุดของร้าน"
            icon={History}
            action={
              <Link
                href="/movements"
                className={buttonVariants({
                  variant: "ghost",
                })}
              >
                ดูทั้งหมด
                <ArrowRight className="size-4" aria-hidden="true" />
              </Link>
            }
          />

          {recentMovements.length === 0 ? (
            <EmptyState
              className="mt-4"
              icon={ClipboardList}
              title="ยังไม่มีความเคลื่อนไหว"
              description="เมื่อรับเข้า เบิก หรือบันทึกของเสีย รายการจะแสดงที่นี่"
            />
          ) : (
            <RecordList
              className="mt-4"
              label="ความเคลื่อนไหวล่าสุด"
            >
              {recentMovements.map((movement) => {
                const item =
                  itemById.get(
                    movement.item_id,
                  );

                const unit =
                  unitById.get(
                    movement.base_unit_id,
                  );

                const quantity =
                  toNumber(
                    movement.base_quantity,
                  );

                const symbol =
                  unit?.symbol ||
                  unit?.code ||
                  "";

                const isWaste =
                  movement.movement_type ===
                  "WASTE";

                const isInbound =
                  quantity > 0;

                return (
                  <RecordItem
                    key={movement.id}
                    title={item?.name ?? "สินค้าที่ปิดใช้งาน"}
                    subtitle={
                      <span className="inline-flex items-center gap-1">
                        {isInbound ? (
                          <ArrowDownToLine className="size-3.5" aria-hidden="true" />
                        ) : (
                          <ArrowUpFromLine className="size-3.5" aria-hidden="true" />
                        )}
                        {movementLabel(
                          movement.movement_type,
                        )}
                        {" · "}
                        {formatActivityTime(
                          movement.occurred_at,
                        )}
                      </span>
                    }
                    value={formatSignedQuantity(
                      quantity,
                      symbol,
                    )}
                    valueClassName={
                      isWaste
                        ? "text-danger"
                        : isInbound
                          ? "text-success"
                          : undefined
                    }
                  />
                );
              })}
            </RecordList>
          )}
        </Panel>
      </div>

      {/* 5. AI insight / reports shortcut */}
      <section
        aria-labelledby="insight-title"
        className="relative overflow-hidden rounded-xl border border-brand-soft-strong bg-brand-soft p-4 md:p-5"
      >
        <BrandPattern opacity={0.05} />

        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-surface text-brand">
              <Cpu className="size-5" aria-hidden="true" />
            </span>

            <div>
              <h2 id="insight-title" className="text-base font-semibold text-foreground">
                สรุปร้านด้วย Local AI
              </h2>
              <p className="mt-0.5 text-sm text-muted-foreground">
                ดูรายงานของเสีย การจัดซื้อ และให้ AI
                ที่ประมวลผลบนเครื่องช่วยสรุปจุดที่ควรสนใจ
              </p>
            </div>
          </div>

          <Link
            href="/reports"
            className={cn(buttonVariants(), "shrink-0")}
          >
            <PackageCheck className="size-4" aria-hidden="true" />
            ไปหน้ารายงาน
          </Link>
        </div>
      </section>
    </div>
  );
}

function DashboardLoading() {
  return (
    <div
      className="space-y-6 md:space-y-8"
      aria-busy="true"
      aria-label="กำลังโหลดภาพรวมร้าน"
    >
      <Skeleton className="h-12 w-64" />
      <Skeleton className="h-56 w-full" />
      <div className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-4">
        <Skeleton className="h-32" />
        <Skeleton className="h-32" />
        <Skeleton className="h-32" />
        <Skeleton className="h-32" />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Skeleton className="h-80" />
        <Skeleton className="h-80" />
      </div>
    </div>
  );
}

export default function DashboardPage() {
  return (
    <Suspense
      fallback={
        <DashboardLoading />
      }
    >
      <DashboardContent />
    </Suspense>
  );
}
