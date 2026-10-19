import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type PageHeaderProps = {
  title: ReactNode;
  description?: ReactNode;
  icon?: LucideIcon;
  // Small text above the title, e.g. a back link or context.
  eyebrow?: ReactNode;
  // Right side on md+, below the title on mobile.
  actions?: ReactNode;
  className?: string;
};

export function PageHeader({
  title,
  description,
  icon: Icon,
  eyebrow,
  actions,
  className,
}: PageHeaderProps) {
  return (
    <header
      className={cn(
        "flex flex-col gap-4 md:flex-row md:items-end md:justify-between",
        className,
      )}
    >
      <div className="min-w-0">
        {eyebrow ? <div className="mb-3">{eyebrow}</div> : null}

        <div className="flex items-start gap-3">
          {Icon ? (
            <span className="mt-0.5 hidden size-11 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand-deep sm:flex">
              <Icon className="size-5" aria-hidden="true" />
            </span>
          ) : null}

          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground md:text-[1.75rem] md:leading-tight">
              {title}
            </h1>

            {description ? (
              <p className="mt-1 text-sm text-muted-foreground md:text-base">
                {description}
              </p>
            ) : null}
          </div>
        </div>
      </div>

      {actions ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {actions}
        </div>
      ) : null}
    </header>
  );
}

type SectionHeaderProps = {
  title: ReactNode;
  description?: ReactNode;
  icon?: LucideIcon;
  action?: ReactNode;
  // Heading level; sections inside the page default to h2.
  as?: "h2" | "h3";
  id?: string;
  className?: string;
};

export function SectionHeader({
  title,
  description,
  icon: Icon,
  action,
  as: Heading = "h2",
  id,
  className,
}: SectionHeaderProps) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-start justify-between gap-3",
        className,
      )}
    >
      <div className="flex min-w-0 items-start gap-3">
        {Icon ? (
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-brand-deep">
            <Icon className="size-[1.125rem]" aria-hidden="true" />
          </span>
        ) : null}

        <div className="min-w-0">
          <Heading
            id={id}
            className="text-base font-semibold leading-snug text-foreground"
          >
            {title}
          </Heading>

          {description ? (
            <p className="mt-0.5 text-sm text-muted-foreground">
              {description}
            </p>
          ) : null}
        </div>
      </div>

      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

/** White card section with comfortable padding. */
export function Panel({
  children,
  className,
  ...props
}: React.ComponentProps<"section">) {
  return (
    <section
      className={cn(
        "rounded-xl border bg-card p-4 shadow-card md:p-5",
        className,
      )}
      {...props}
    >
      {children}
    </section>
  );
}
