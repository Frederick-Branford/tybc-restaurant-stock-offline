import {
  CheckCircle2,
  Info,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type NoticeTone = "success" | "error" | "warning" | "info";

const TONES: Record<
  NoticeTone,
  { icon: LucideIcon; className: string; role: "status" | "alert" }
> = {
  success: {
    icon: CheckCircle2,
    className: "border-success-border bg-success-soft text-success",
    role: "status",
  },
  error: {
    icon: TriangleAlert,
    className: "border-danger-border bg-danger-soft text-danger",
    role: "alert",
  },
  warning: {
    icon: TriangleAlert,
    className: "border-warning-border bg-warning-soft text-warning",
    role: "status",
  },
  info: {
    icon: Info,
    className: "border-border bg-surface-warm text-foreground",
    role: "status",
  },
};

/** Inline feedback banner. Errors are announced as alerts. */
export function Notice({
  tone = "info",
  title,
  children,
  className,
}: {
  tone?: NoticeTone;
  title?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  const { icon: Icon, className: toneClass, role } = TONES[tone];

  return (
    <div
      role={role}
      className={cn(
        "flex items-start gap-3 rounded-xl border px-4 py-3 text-sm",
        toneClass,
        className,
      )}
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />

      <div className="min-w-0">
        {title ? <p className="font-semibold">{title}</p> : null}
        {children ? <div className={title ? "mt-0.5" : undefined}>{children}</div> : null}
      </div>
    </div>
  );
}
