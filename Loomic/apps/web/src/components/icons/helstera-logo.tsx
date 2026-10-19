export function HelsteraLogo({
  className,
  alt = "Helstera",
}: {
  className?: string;
  alt?: string;
}) {
  return (
    <span
      className={`helstera-wordmark ${className ?? ""}`.trim()}
      role={alt ? "img" : undefined}
      aria-label={alt || undefined}
      aria-hidden={alt ? undefined : true}
    >
      Helstera
    </span>
  );
}
