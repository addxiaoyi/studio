import { cn } from "@/lib/utils";

/**
 * Helstera brand logo (PNG).
 * Renders the helstera.png from /public. The source is a 1024x1024
 * black-background PNG with a white "HELSKINA" wordmark and a small
 * five-pointed star between the E and the S.
 *
 * This file is intentionally NOT a client component so it can be
 * imported from both server and client components.
 *
 * @example
 * <HelsteraLogo className="size-8 rounded" />
 */
export function HelsteraLogo({
  className,
  alt = "Helstera",
}: {
  className?: string;
  alt?: string;
}) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/logo-helstera.png"
      alt={alt}
      aria-hidden={alt === "Helstera" ? "true" : undefined}
      className={cn("rounded object-contain", className)}
    />
  );
}
