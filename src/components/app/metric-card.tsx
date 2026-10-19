import Link from "next/link";
import { ChevronRight, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type MetricTone = "neutral" | "brand" | "success" | "warning" | "danger";

const ICON_TONES: Record<MetricTone, string> = {
  neutral: "bg-surface-muted text-muted-foreground",
  brand: "bg-brand-soft text-brand-deep",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
};

type MetricCardProps = {
  label: ReactNode;
  value: ReactNode;
  unit?: ReactNode;
  icon: LucideIcon;
  tone?: MetricTone;
  hint?: ReactNode;
  href?: string;
  className?: string;
};

export function MetricCard({
  label,
  value,
  unit,
  icon: Icon,
  tone = "neutral",
  hint,
  href,
  className,
}: MetricCardProps) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-muted-foreground">{label}</p>

        <span
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-lg",
            ICON_TONES[tone],
          )}
        >
          <Icon className="size-[1.125rem]" aria-hidden="true" />
        </span>
      </div>

      <p className="mt-2 flex items-baseline gap-1.5 text-3xl font-semibold tracking-tight text-foreground tabular-nums">
        {value}
        {unit ? (
          <span className="text-sm font-medium tracking-normal text-muted-foreground">
            {unit}
          </span>
        ) : null}
      </p>

      {hint ? (
        <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
          {hint}
          {href ? (
            <ChevronRight className="size-3.5 shrink-0" aria-hidden="true" />
          ) : null}
        </p>
      ) : null}
    </>
  );

  const classes = cn(
    "block rounded-xl border bg-card p-4 shadow-card md:p-5",
    href &&
      "transition-colors hover:border-brand-soft-strong hover:bg-surface-warm focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40",
    className,
  );

  return href ? (
    <Link href={href} className={classes}>
      {body}
    </Link>
  ) : (
    <div className={classes}>{body}</div>
  );
}
