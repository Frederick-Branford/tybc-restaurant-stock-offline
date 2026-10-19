import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import {
  Boxes,
  ChevronDown,
  PackagePlus,
} from "lucide-react";

import { EmptyState } from "@/components/app/empty-state";
import {
  Field,
  FormSection,
  NativeSelect,
} from "@/components/app/form-controls";
import { Notice } from "@/components/app/notice";
import {
  PageHeader,
  Panel,
  SectionHeader,
} from "@/components/app/page-header";
import {
  RecordItem,
  RecordList,
} from "@/components/app/record-list";
import {
  StatusPill,
  StockStatusBadge,
  stockLevelIcon,
} from "@/components/app/stock-status-badge";
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
import { cn } from "@/lib/utils";
import {
  formatCount,
  formatQuantity,
} from "@/lib/ui/format";
import {
  STOCK_LEVEL_LABELS,
  STOCK_LEVELS,
  stockLevel,
} from "@/lib/ui/stock-level";
import { createClient } from "@/lib/supabase/server";

import { createItem } from "./actions";

export const metadata: Metadata = {
  title: "คลังสินค้า",
};

type InventoryPageProps = {
  searchParams: Promise<{
    created?: string;
    error?: string;
  }>;
};

async function InventoryContent({
  searchParams,
}: InventoryPageProps) {
  await connection();
  const supabase = await createClient();

  const params = await searchParams;

  const [
    itemResult,
    balanceResult,
    categoryResult,
    unitResult,
  ] = await Promise.all([
    supabase
      .from("items")
      .select(
        "id, sku, name, category_id, base_unit_id, minimum_stock, reorder_point, is_active",
      )
      .order("name"),

    supabase
      .from("inventory_balances")
      .select(
        "item_id, current_quantity, base_unit_symbol, stock_status, below_minimum",
      ),

    supabase
      .from("categories")
      .select("id, code, name")
      .eq("is_active", true)
      .order("name"),

    supabase
      .from("units")
      .select("id, code, name, symbol")
      .eq("is_active", true)
      .order("name"),
  ]);

  if (
    itemResult.error ||
    balanceResult.error ||
    categoryResult.error ||
    unitResult.error
  ) {
    throw new Error(
      "Unable to load inventory information.",
    );
  }

  const items = itemResult.data ?? [];
  const balances = balanceResult.data ?? [];
  const categories = categoryResult.data ?? [];
  const units = unitResult.data ?? [];

  const categoryMap = new Map(
    categories.map((category) => [
      category.id,
      category.name,
    ]),
  );

  const unitMap = new Map(
    units.map((unit) => [
      unit.id,
      unit.symbol || unit.code,
    ]),
  );

  const balanceMap = new Map(
    balances.map((balance) => [
      balance.item_id,
      balance,
    ]),
  );

  const errorMessage =
    params.error === "invalid"
      ? "ข้อมูลไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง"
      : params.error === "reorder"
        ? "จุดสั่งซื้อต้องไม่น้อยกว่าสต็อกขั้นต่ำ"
        : params.error === "duplicate"
          ? "SKU หรือชื่อสินค้านี้มีอยู่แล้ว"
          : null;

  const rows = items.map((item) => {
    const balance =
      balanceMap.get(item.id);

    const symbol =
      balance?.base_unit_symbol ??
      unitMap.get(item.base_unit_id) ??
      "";

    return {
      ...item,
      quantity:
        balance?.current_quantity ?? 0,
      symbol,
      category:
        categoryMap.get(item.category_id) ??
        "-",
      level: stockLevel(
        balance?.stock_status ??
          "OUT_OF_STOCK",
        balance?.below_minimum,
      ),
    };
  });

  const levelCounts = STOCK_LEVELS.map(
    (level) => ({
      level,
      count: rows.filter(
        (row) =>
          row.is_active &&
          row.level === level,
      ).length,
    }),
  );

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Boxes}
        title="คลังสินค้า"
        description="วัตถุดิบ เครื่องดื่ม บรรจุภัณฑ์ และอุปกรณ์ของร้าน"
      />

      {params.created === "1" ? (
        <Notice tone="success">
          เพิ่มรายการสินค้าเรียบร้อยแล้ว
        </Notice>
      ) : null}

      {errorMessage ? (
        <Notice tone="error">{errorMessage}</Notice>
      ) : null}

      <ul
        className="grid grid-cols-2 gap-2 sm:grid-cols-4"
        aria-label="สรุปสถานะสินค้า"
      >
        {levelCounts.map(({ level, count }) => {
          const Icon = stockLevelIcon(level);

          return (
            <li
              key={level}
              className="flex items-center justify-between gap-2 rounded-xl bg-surface-muted px-3 py-2.5"
            >
              <span className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
                <Icon className="size-4 shrink-0" aria-hidden="true" />
                <span className="truncate">
                  {STOCK_LEVEL_LABELS[level]}
                </span>
              </span>
              <span className="text-xl font-semibold text-foreground tabular-nums">
                {formatCount(count)}
              </span>
            </li>
          );
        })}
      </ul>

      <Panel aria-labelledby="inventory-list-title">
        <SectionHeader
          id="inventory-list-title"
          title="รายการในคลัง"
          description={`${formatCount(items.length)} รายการ · ยอดคงเหลือคำนวณจาก Stock Ledger`}
          icon={Boxes}
        />

        {items.length === 0 ? (
          <EmptyState
            className="mt-4"
            icon={Boxes}
            title="ยังไม่มีสินค้าในคลัง"
            description="เพิ่มรายการแรกจากแบบฟอร์มด้านล่าง"
          />
        ) : (
          <>
            <RecordList
              className="mt-4 lg:hidden"
              label="รายการในคลัง"
            >
              {rows.map((row) => (
                <RecordItem
                  key={row.id}
                  title={row.name}
                  subtitle={`${row.sku} · ${row.category}`}
                  meta={`จุดสั่งซื้อ ${formatQuantity(row.reorder_point, row.symbol)} · ขั้นต่ำ ${formatQuantity(row.minimum_stock, row.symbol)}`}
                  value={formatQuantity(row.quantity, row.symbol)}
                  aside={
                    row.is_active ? (
                      <StockStatusBadge level={row.level} />
                    ) : (
                      <StatusPill>ปิดใช้งาน</StatusPill>
                    )
                  }
                />
              ))}
            </RecordList>

            <div className="mt-4 hidden overflow-hidden rounded-xl border lg:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>สินค้า</TableHead>
                    <TableHead>หมวดหมู่</TableHead>
                    <TableHead className="text-right">
                      คงเหลือ
                    </TableHead>
                    <TableHead className="text-right">
                      จุดสั่งซื้อ
                    </TableHead>
                    <TableHead className="text-right">
                      ขั้นต่ำ
                    </TableHead>
                    <TableHead>สถานะ</TableHead>
                  </TableRow>
                </TableHeader>

                <TableBody>
                  {rows.map((row) => (
                    <TableRow
                      key={row.id}
                      className={cn(!row.is_active && "text-muted-foreground")}
                    >
                      <TableCell className="whitespace-normal">
                        <p className="font-medium text-foreground">
                          {row.name}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {row.sku}
                        </p>
                      </TableCell>
                      <TableCell>{row.category}</TableCell>
                      <TableCell className="text-right text-base font-semibold text-foreground tabular-nums">
                        {formatQuantity(row.quantity, row.symbol)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatQuantity(row.reorder_point, row.symbol)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatQuantity(row.minimum_stock, row.symbol)}
                      </TableCell>
                      <TableCell>
                        {row.is_active ? (
                          <StockStatusBadge level={row.level} />
                        ) : (
                          <StatusPill>ปิดใช้งาน</StatusPill>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </Panel>

      <details
        className="group rounded-xl border bg-card shadow-card"
        open={Boolean(errorMessage) || items.length === 0}
      >
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-xl p-4 md:p-5 [&::-webkit-details-marker]:hidden">
          <span className="flex min-w-0 items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-brand-deep">
              <PackagePlus className="size-[1.125rem]" aria-hidden="true" />
            </span>
            <span className="min-w-0">
              <span className="block text-base font-semibold text-foreground">
                เพิ่มรายการใหม่
              </span>
              <span className="block text-sm text-muted-foreground">
                กำหนดหน่วยหลักสำหรับใช้คำนวณ Stock ภายในระบบ
              </span>
            </span>
          </span>
          <ChevronDown
            className="size-5 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
            aria-hidden="true"
          />
        </summary>

        <form
          action={createItem}
          className="grid gap-6 border-t p-4 md:p-5"
        >
          <FormSection title="ข้อมูลสินค้า">
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="SKU" htmlFor="sku" required hint="รหัสภาษาอังกฤษ ใช้ค้นหาและอ้างอิง">
                <Input
                  id="sku"
                  name="sku"
                  placeholder="CHICKEN-BREAST"
                  autoCapitalize="characters"
                  required
                />
              </Field>

              <Field label="ชื่อสินค้า / วัตถุดิบ" htmlFor="name" required>
                <Input
                  id="name"
                  name="name"
                  placeholder="อกไก่"
                  required
                />
              </Field>

              <Field label="หมวดหมู่" htmlFor="categoryId" required>
                <NativeSelect
                  id="categoryId"
                  name="categoryId"
                  required
                  defaultValue=""
                >
                  <option value="" disabled>
                    เลือกหมวดหมู่
                  </option>
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </NativeSelect>
              </Field>

              <Field label="หน่วยหลัก" htmlFor="baseUnitId" required hint="Stock ทั้งหมดของสินค้านี้จะคำนวณเป็นหน่วยนี้">
                <NativeSelect
                  id="baseUnitId"
                  name="baseUnitId"
                  required
                  defaultValue=""
                >
                  <option value="" disabled>
                    เลือกหน่วย
                  </option>
                  {units.map((unit) => (
                    <option key={unit.id} value={unit.id}>
                      {unit.name}
                      {" ("}
                      {unit.symbol || unit.code}
                      {")"}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            </div>
          </FormSection>

          <FormSection
            title="จุดแจ้งเตือน"
            description="จุดสั่งซื้อต้องไม่น้อยกว่าสต็อกขั้นต่ำ"
          >
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Stock ขั้นต่ำ" htmlFor="minimumStock" required>
                <Input
                  id="minimumStock"
                  name="minimumStock"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.0001"
                  defaultValue="0"
                  required
                />
              </Field>

              <Field label="จุดแจ้งเตือนสั่งซื้อ" htmlFor="reorderPoint" required>
                <Input
                  id="reorderPoint"
                  name="reorderPoint"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.0001"
                  defaultValue="0"
                  required
                />
              </Field>
            </div>
          </FormSection>

          <div>
            <SubmitButton className="w-full sm:w-auto">
              <PackagePlus className="size-4" aria-hidden="true" />
              เพิ่มรายการ
            </SubmitButton>
          </div>
        </form>
      </details>
    </div>
  );
}

function InventoryLoading() {
  return (
    <div className="space-y-6" aria-busy="true">
      <Skeleton className="h-12 w-52" />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Skeleton className="h-14" />
        <Skeleton className="h-14" />
        <Skeleton className="h-14" />
        <Skeleton className="h-14" />
      </div>
      <Skeleton className="h-96 w-full" />
    </div>
  );
}

export default function InventoryPage(
  props: InventoryPageProps,
) {
  return (
    <Suspense fallback={<InventoryLoading />}>
      <InventoryContent {...props} />
    </Suspense>
  );
}
