import {
  CheckCircle2,
  CircleX,
  TrendingDown,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import {
  STOCK_LEVEL_LABELS,
  type StockLevel,
} from "@/lib/ui/stock-level";

// Icon + text + colour for every level: never colour alone.
const STYLES: Record<StockLevel, { icon: LucideIcon; className: string }> = {
  NORMAL: {
    icon: CheckCircle2,
    className: "border-success-border bg-success-soft text-success",
  },
  NEAR_REORDER: {
    icon: TrendingDown,
    className: "border-warning-border bg-warning-soft text-warning",
  },
  BELOW_MINIMUM: {
    icon: TriangleAlert,
    className: "border-danger-border bg-danger-soft text-danger",
  },
  OUT_OF_STOCK: {
    icon: CircleX,
    className: "border-critical bg-critical text-white",
  },
};

export function stockLevelIcon(level: StockLevel): LucideIcon {
  return STYLES[level].icon;
}

export function StockStatusBadge({
  level,
  className,
}: {
  level: StockLevel;
  className?: string;
}) {
  const { icon: Icon, className: tone } = STYLES[level];

  return (
    <span
      className={cn(
        "inline-flex w-fit shrink-0 items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap",
        tone,
        className,
      )}
    >
      <Icon className="size-3.5" aria-hidden="true" />
      {STOCK_LEVEL_LABELS[level]}
    </span>
  );
}

type Tone = "neutral" | "brand" | "success" | "warning" | "danger" | "critical";

const TONE_CLASSES: Record<Tone, string> = {
  neutral: "border-border bg-surface-muted text-foreground",
  brand: "border-brand-soft-strong bg-brand-soft text-brand-deep",
  success: "border-success-border bg-success-soft text-success",
  warning: "border-warning-border bg-warning-soft text-warning",
  danger: "border-danger-border bg-danger-soft text-danger",
  critical: "border-critical bg-critical text-white",
};

/** Generic status pill (PO status, count status …) with optional icon. */
export function StatusPill({
  tone = "neutral",
  icon: Icon,
  children,
  className,
}: {
  tone?: Tone;
  icon?: LucideIcon;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex w-fit shrink-0 items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap",
        TONE_CLASSES[tone],
        className,
      )}
    >
      {Icon ? <Icon className="size-3.5" aria-hidden="true" /> : null}
      {children}
    </span>
  );
}
