import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";

import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/** Styled native select: large touch target, visible focus, chevron. */
export function NativeSelect({
  className,
  wrapperClassName,
  ...props
}: React.ComponentProps<"select"> & { wrapperClassName?: string }) {
  return (
    <div className={cn("relative min-w-0", wrapperClassName)}>
      <select
        className={cn(
          "h-11 w-full min-w-0 appearance-none truncate rounded-lg border border-input bg-surface pr-10 pl-3 text-base text-foreground transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50 md:h-10 md:text-sm",
          className,
        )}
        {...props}
      />
      <ChevronDown
        className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden="true"
      />
    </div>
  );
}

/** Label + control + optional hint. */
export function Field({
  label,
  htmlFor,
  hint,
  required = false,
  children,
  className,
}: {
  label: ReactNode;
  htmlFor?: string;
  hint?: ReactNode;
  required?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("grid content-start gap-1.5", className)}>
      <Label htmlFor={htmlFor}>
        {label}
        {required ? (
          <span className="text-danger" aria-hidden="true">
            *
          </span>
        ) : null}
      </Label>

      {children}

      {hint ? (
        <p className="text-xs leading-relaxed text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

/** Read-only value shown in a form (e.g. current stock). */
export function ReadOnlyValue({
  label,
  children,
  className,
}: {
  label: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("grid content-start gap-1.5", className)}>
      <p className="text-sm leading-snug font-medium">{label}</p>
      <p className="flex min-h-11 items-center rounded-lg border border-dashed bg-surface-warm px-3 text-base font-semibold tabular-nums md:min-h-10">
        {children}
      </p>
    </div>
  );
}

/** Groups related fields under a short heading. */
export function FormSection({
  title,
  description,
  children,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <fieldset className={cn("grid min-w-0 gap-4", className)}>
      <legend className="mb-3 w-full">
        <span className="block text-sm font-semibold text-foreground">
          {title}
        </span>
        {description ? (
          <span className="mt-0.5 block text-xs text-muted-foreground">
            {description}
          </span>
        ) : null}
      </legend>
      {children}
    </fieldset>
  );
}

/**
 * Keeps the primary action within thumb reach on phones: sticks above the
 * bottom navigation while the form is on screen. Static from md.
 */
export function MobileActionBar({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "sticky bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-20 -mx-4 flex flex-col gap-2 border-t bg-surface/95 px-4 py-3 backdrop-blur-sm sm:flex-row sm:items-center md:static md:mx-0 md:border-0 md:bg-transparent md:p-0 md:backdrop-blur-none",
        className,
      )}
    >
      {children}
    </div>
  );
}
