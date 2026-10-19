import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/** Stacked rows for phones/tablets instead of a squeezed table. */
export function RecordList({
  children,
  className,
  label,
}: {
  children: ReactNode;
  className?: string;
  label?: string;
}) {
  return (
    <ul
      aria-label={label}
      className={cn("divide-y overflow-hidden rounded-xl border bg-card", className)}
    >
      {children}
    </ul>
  );
}

type RecordItemProps = {
  title: ReactNode;
  subtitle?: ReactNode;
  // Primary number, right aligned.
  value?: ReactNode;
  valueClassName?: string;
  // Under the value (e.g. a badge or time).
  aside?: ReactNode;
  // Extra lines under the title.
  meta?: ReactNode;
  href?: string;
  className?: string;
};

export function RecordItem({
  title,
  subtitle,
  value,
  valueClassName,
  aside,
  meta,
  href,
  className,
}: RecordItemProps) {
  const content = (
    <>
      <div className="min-w-0 flex-1">
        <p className="font-medium text-foreground">{title}</p>
        {subtitle ? (
          <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>
        ) : null}
        {meta ? <div className="mt-1.5 text-sm text-muted-foreground">{meta}</div> : null}
      </div>

      {value || aside ? (
        <div className="flex shrink-0 flex-col items-end gap-1 text-right">
          {value ? (
            <p
              className={cn(
                "text-base font-semibold text-foreground tabular-nums",
                valueClassName,
              )}
            >
              {value}
            </p>
          ) : null}
          {aside}
        </div>
      ) : null}

      {href ? (
        <ChevronRight
          className="mt-0.5 size-4 shrink-0 text-muted-foreground"
          aria-hidden="true"
        />
      ) : null}
    </>
  );

  return (
    <li className={className}>
      {href ? (
        <Link
          href={href}
          className="flex items-start gap-3 px-4 py-3.5 transition-colors hover:bg-brand-soft/40 focus-visible:bg-brand-soft/40 focus-visible:outline-none"
        >
          {content}
        </Link>
      ) : (
        <div className="flex items-start gap-3 px-4 py-3.5">{content}</div>
      )}
    </li>
  );
}
