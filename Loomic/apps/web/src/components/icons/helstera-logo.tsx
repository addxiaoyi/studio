import { cn } from "@/lib/utils";

export function HelsteraLogo({
  className,
  alt = "Helstera",
}: {
  className?: string;
  alt?: string;
}) {
  return (
    <svg
      viewBox="0 0 100 100"
      role={alt ? "img" : undefined}
      aria-hidden={alt ? undefined : true}
      className={cn("shrink-0", className)}
      xmlns="http://www.w3.org/2000/svg"
    >
      {alt && <title>{alt}</title>}
      <path
        d="M50 4c6 0 14 4 18 12 6-6 16-6 22 2 6 8 6 18 0 24 8 6 10 16 6 24-4 8-12 12-20 10-4 8-14 16-26 16S28 84 24 76c-8 2-16-2-20-10-4-8-2-18 6-24-6-6-6-16 0-24 6-8 16-8 22-2C36 8 44 4 50 4Z"
        fill="currentColor"
      />
      <path d="m29 43 7-15 7 15 13 7-13 7-7 15-7-15-13-7 13-7Z" fill="var(--background)" />
      <path d="M55 38q11 20 22 0" fill="none" stroke="var(--background)" strokeLinecap="round" strokeWidth="5.5" />
    </svg>
  );
}
