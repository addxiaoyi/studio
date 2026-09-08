"use client";

import Image from "next/image";

/**
 * All four visual components are identical in markup (a glass-framed
 * 4:3 image). We use a single shared visual component and pass the
 * asset + alt text in via props — saves ~120 lines of near-duplicate JSX.
 *
 * Original showcase images are hosted under /images/showcase.
 */
export function CanvasVisual() {
  return <ShowcaseImage src="/images/showcase/showcase-5.jpg" alt="AI canvas" />;
}

export function ChatVisual() {
  return <ShowcaseImage src="/images/showcase/showcase-10.jpg" alt="AI understanding" />;
}

export function BrandVisual() {
  return <ShowcaseImage src="/images/showcase/showcase-11.jpg" alt="Brand consistency" />;
}

export function EditVisual() {
  return <ShowcaseImage src="/images/showcase/showcase-3.jpg" alt="Pixel-level editing" />;
}

function ShowcaseImage({ src, alt }: { src: string; alt: string }) {
  return (
    <div className="aspect-[4/3] relative overflow-hidden rounded-2xl">
      <Image
        src={src}
        alt={alt}
        width={800}
        height={600}
        unoptimized
        className="absolute inset-0 w-full h-full object-cover"
        loading="lazy"
        sizes="(max-width: 1024px) 100vw, 50vw"
      />
    </div>
  );
}
