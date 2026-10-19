import { cn } from "@/lib/utils";

// Decorative only. Generic curls, leaves and chili shapes inspired by Thai
// ornament and tom yum ingredients — not the logo. Kept at 2–5% opacity so
// it never competes with content.

export function BrandPattern({
  className,
  opacity = 0.045,
}: {
  className?: string;
  opacity?: number;
}) {
  // Identical definitions may repeat on a page; the id can be shared.
  const id = "tybc";

  return (
    <svg
      aria-hidden="true"
      focusable="false"
      className={cn(
        "pointer-events-none absolute inset-0 h-full w-full text-brand-deep",
        className,
      )}
      style={{ opacity }}
    >
      <defs>
        <pattern
          id={`brand-pattern-${id}`}
          width="132"
          height="132"
          patternUnits="userSpaceOnUse"
        >
          <g
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
          >
            {/* ornamental curl */}
            <path d="M18 54c0-14 10-24 22-24 9 0 15 6 15 13 0 6-4 10-9 10-4 0-7-3-7-6" />
            {/* double kaffir-lime leaf */}
            <path d="M84 20c10 2 16 9 16 18-9-1-16-8-16-18Z" />
            <path d="M100 38c8 3 12 10 11 18-8-2-13-9-11-18Z" />
            <path d="M84 20l27 36" />
            {/* chili */}
            <path d="M38 98c10 12 30 16 46 8-14-1-26-7-34-18" />
            <path d="M50 88c-2-4-1-8 3-10" />
            {/* small flourish */}
            <path d="M104 100c6-6 14-4 15 2 1 5-5 8-8 4" />
          </g>
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#brand-pattern-${id})`} />
    </svg>
  );
}

/** Line-art ingredient sprig (lemongrass, chili, lime leaf) for brand panels. */
export function IngredientSprig({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 160 120"
      className={cn("pointer-events-none", className)}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {/* lemongrass stalks */}
      <path d="M30 112c6-30 8-62 4-96" />
      <path d="M40 112c2-26 10-52 26-78" />
      <path d="M22 112c-2-22 0-44 8-64" />
      {/* lime leaves */}
      <path d="M92 40c18-2 30 8 32 24-17 1-29-8-32-24Z" />
      <path d="M124 64c14 2 22 12 22 26-14-1-23-11-22-26Z" />
      <path d="M92 40l54 50" />
      {/* chili */}
      <path d="M66 96c16 14 44 16 64 2-20 0-38-8-50-22" />
      <path d="M82 78c-4-6-2-12 4-14" />
    </svg>
  );
}
