import Link from "next/link";
import {
  ArrowRight,
  CheckCircle2,
  TriangleAlert,
} from "lucide-react";

import {
  StockStatusBadge,
  stockLevelIcon,
} from "@/components/app/stock-status-badge";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatCount } from "@/lib/ui/format";
import {
  STOCK_LEVEL_LABELS,
  type StockLevel,
} from "@/lib/ui/stock-level";

export type AttentionItem = {
  id: string;
  name: string;
  quantity: string;
  level: StockLevel;
  // Secondary fact line, e.g. "จุดสั่งซื้อ 1,000 g".
  detail: string;
};

type AttentionLevel = Exclude<StockLevel, "NORMAL">;

const ATTENTION_LEVELS: AttentionLevel[] = [
  "OUT_OF_STOCK",
  "BELOW_MINIMUM",
  "NEAR_REORDER",
];

const ACCENT: Record<AttentionLevel, string> = {
  OUT_OF_STOCK: "bg-critical",
  BELOW_MINIMUM: "bg-danger",
  NEAR_REORDER: "bg-warning",
};

const CHIP: Record<AttentionLevel, string> = {
  OUT_OF_STOCK: "border-critical-border bg-critical-soft text-critical",
  BELOW_MINIMUM: "border-danger-border bg-danger-soft text-danger",
  NEAR_REORDER: "border-warning-border bg-warning-soft text-warning",
};

type OperationalAlertProps = {
  counts: Record<AttentionLevel, number>;
  items: AttentionItem[];
  href: string;
  // Maximum rows listed; the rest are summarised.
  limit?: number;
};

/**
 * "ต้องตรวจสอบ": the first thing on the dashboard. Shows only real
 * attention items; when there are none it says stock is normal.
 */
export function OperationalAlert({
  counts,
  items,
  href,
  limit = 5,
}: OperationalAlertProps) {
  const total = ATTENTION_LEVELS.reduce(
    (sum, level) => sum + counts[level],
    0,
  );

  if (total === 0) {
    return (
      <section
        aria-labelledby="attention-title"
        className="flex flex-col gap-4 rounded-xl border border-success-border bg-success-soft p-4 sm:flex-row sm:items-center sm:justify-between md:p-5"
      >
        <div className="flex items-start gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-surface text-success">
            <CheckCircle2 className="size-6" aria-hidden="true" />
          </span>
          <div>
            <h2 id="attention-title" className="text-base font-semibold text-foreground">
              ต้องตรวจสอบ
            </h2>
            <p className="mt-0.5 text-sm text-success">
              Stock โดยรวมอยู่ในระดับปกติ
            </p>
          </div>
        </div>

        <Link href={href} className={buttonVariants({ variant: "outline" })}>
          ดูคลังสินค้า
        </Link>
      </section>
    );
  }

  const worst =
    ATTENTION_LEVELS.find((level) => counts[level] > 0) ?? "NEAR_REORDER";
  const shown = items.slice(0, limit);

  return (
    <section
      aria-labelledby="attention-title"
      className="relative overflow-hidden rounded-xl border bg-card shadow-card"
    >
      <span
        className={cn("absolute inset-x-0 top-0 h-1", ACCENT[worst])}
        aria-hidden="true"
      />

      <div className="p-4 md:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex items-start gap-3">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-danger-soft text-danger">
              <TriangleAlert className="size-6" aria-hidden="true" />
            </span>

            <div>
              <h2 id="attention-title" className="text-sm font-semibold text-muted-foreground">
                ต้องตรวจสอบ
              </h2>
              <p className="text-2xl font-semibold tracking-tight text-foreground">
                <span className="tabular-nums">{formatCount(total)}</span>{" "}
                รายการต้องดูแล
              </p>
            </div>
          </div>

          <ul className="flex flex-wrap gap-2" aria-label="สรุปตามสถานะ">
            {ATTENTION_LEVELS.map((level) => {
              const Icon = stockLevelIcon(level);
              const count = counts[level];

              return (
                <li
                  key={level}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-medium",
                    count > 0
                      ? CHIP[level]
                      : "border-border bg-surface-muted text-muted-foreground",
                  )}
                >
                  <Icon className="size-4" aria-hidden="true" />
                  {STOCK_LEVEL_LABELS[level]}
                  <span className="font-semibold tabular-nums">
                    {formatCount(count)}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>

        <ul className="mt-4 divide-y rounded-xl border">
          {shown.map((item) => (
            <li
              key={item.id}
              className="flex items-start justify-between gap-3 px-4 py-3"
            >
              <div className="min-w-0">
                <p className="font-medium text-foreground">{item.name}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {item.detail}
                </p>
              </div>

              <div className="flex shrink-0 flex-col items-end gap-1">
                <p className="text-lg leading-tight font-semibold text-foreground tabular-nums">
                  {item.quantity}
                </p>
                <StockStatusBadge level={item.level} />
              </div>
            </li>
          ))}
        </ul>

        <div className="mt-4 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-muted-foreground">
            {items.length > shown.length
              ? `แสดง ${formatCount(shown.length)} จาก ${formatCount(items.length)} รายการ เรียงจากเร่งด่วนที่สุด`
              : "เรียงจากเร่งด่วนที่สุด"}
          </p>

          <Link href={href} className={buttonVariants()}>
            ดูคลังสินค้า
            <ArrowRight className="size-4" aria-hidden="true" />
          </Link>
        </div>
      </div>
    </section>
  );
}
