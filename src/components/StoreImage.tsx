"use client";
import Image from "next/image";
import { useState } from "react";
interface Props {
  src: string;
  alt: string;
  width: number;
  height: number;
  sizes?: string;
  priority?: boolean;
  loading?: "eager" | "lazy";
  className?: string;
}
export function StoreImage({ src, alt, width, height, ...props }: Props) {
  const [failedSource, setFailedSource] = useState<string>();
  if (failedSource === src)
    return (
      <div
        className={`store-image-fallback ${props.className ?? ""}`}
        role="img"
        aria-label={`${alt} (image unavailable)`}
        style={{ aspectRatio: `${width}/${height}` }}
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          width="28"
          height="28"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        >
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <circle cx="8" cy="8" r="2" />
          <path d="m3 17 6-6 4 4 3-3 5 5" />
        </svg>
        <span>Image unavailable</span>
      </div>
    );
  return (
    <Image
      src={src}
      alt={alt}
      width={width}
      height={height}
      {...props}
      onError={() => setFailedSource(src)}
    />
  );
}
