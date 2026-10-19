"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";

/**
 * The supplied logo artwork. If the file is missing or fails to load, the
 * image is removed and the tinted tile around it stays empty: never a
 * broken-image icon, and never a substitute drawing of the logo.
 */
export function BrandImage({
  src,
  alt,
  sizes,
  priority = false,
  className,
}: {
  src: string;
  alt: string;
  sizes: string;
  priority?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLImageElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    // The error may have happened before hydration.
    const image = ref.current;

    if (image?.complete && image.naturalWidth === 0) {
      setFailed(true);
    }
  }, []);

  if (failed) {
    return null;
  }

  return (
    <Image
      ref={ref}
      src={src}
      alt={alt}
      fill
      sizes={sizes}
      priority={priority}
      className={className}
      onError={() => setFailed(true)}
    />
  );
}
