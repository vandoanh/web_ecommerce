"use client";

import Image, { type ImageProps } from "next/image";
import { useState } from "react";
import { foodPlaceholder, isFoodPlaceholder } from "@/lib/image-fallback";

type StoreImageProps = Omit<ImageProps, "src" | "alt" | "onError"> & {
  src: string;
  alt: string;
  fallbackAlt: string;
};

export function StoreImage({ src, alt, fallbackAlt, ...props }: StoreImageProps) {
  const [failedSources, setFailedSources] = useState<Set<string>>(() => new Set());
  const showingFallback = failedSources.has(src);
  const displaySrc = showingFallback ? foodPlaceholder : src;

  return (
    <Image
      {...props}
      src={displaySrc}
      alt={showingFallback ? fallbackAlt : alt}
      onError={() => {
        if (isFoodPlaceholder(displaySrc)) return;
        setFailedSources((current) => (current.has(src) ? current : new Set(current).add(src)));
      }}
    />
  );
}
