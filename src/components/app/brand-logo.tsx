import { BrandImage } from "@/components/app/brand-image";
import { BRAND } from "@/lib/brand";
import { cn } from "@/lib/utils";

type BrandMarkProps = {
  size?: number;
  className?: string;
  priority?: boolean;
  // Decorative when the brand name is also written next to it.
  decorative?: boolean;
};

/** The supplied logo artwork as a compact mark. */
export function BrandMark({
  size = 40,
  className,
  priority = false,
  decorative = false,
}: BrandMarkProps) {
  return (
    <span
      className={cn(
        "relative inline-flex shrink-0 overflow-hidden",
        BRAND.mark.transparent
          ? ""
          : "rounded-[28%] bg-brand-soft ring-1 ring-black/5",
        className,
      )}
      style={{ width: size, height: size }}
    >
      <BrandImage
        src={BRAND.mark.src}
        alt={decorative ? "" : BRAND.mark.alt}
        sizes={`${size}px`}
        priority={priority}
        className={BRAND.mark.transparent ? "object-contain" : "object-cover"}
      />
    </span>
  );
}

type BrandLockupProps = {
  // compact: mark + name only (mobile top bar).
  compact?: boolean;
  markSize?: number;
  className?: string;
};

/** Mark + TOM YUM BANG C + HALAL HOME. */
export function BrandLockup({
  compact = false,
  markSize,
  className,
}: BrandLockupProps) {
  return (
    <span className={cn("flex min-w-0 items-center gap-3", className)}>
      <BrandMark size={markSize ?? (compact ? 36 : 44)} decorative />

      <span className="min-w-0 leading-tight">
        <span className="block truncate text-[0.95rem] font-bold tracking-[0.04em] text-foreground">
          {BRAND.name}
        </span>

        {compact ? null : (
          <span className="mt-0.5 block text-[0.6875rem] font-semibold tracking-[0.2em] text-brand-deep">
            {BRAND.tagline}
          </span>
        )}
      </span>
    </span>
  );
}

/**
 * The full square logo, for login and brand panels only. Pass `size`, or
 * size it responsively with className + `sizes`.
 */
export function BrandLogo({
  size,
  sizes,
  className,
  priority = false,
}: {
  size?: number;
  sizes?: string;
  className?: string;
  priority?: boolean;
}) {
  return (
    <span
      className={cn(
        "relative inline-flex shrink-0 overflow-hidden rounded-[22%] bg-brand-soft shadow-raised ring-1 ring-black/5",
        className,
      )}
      style={size ? { width: size, height: size } : undefined}
    >
      <BrandImage
        src={BRAND.logo.src}
        alt={BRAND.logo.alt}
        sizes={sizes ?? `${size ?? 160}px`}
        priority={priority}
        className="object-cover"
      />
    </span>
  );
}
