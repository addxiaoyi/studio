"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useSurfaceEntry } from "@/hooks/use-surface-entry";

export function PageTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const ref=useSurfaceEntry<HTMLDivElement>(pathname);
  return <div ref={ref} className="h-full min-w-0">{children}</div>;
}
