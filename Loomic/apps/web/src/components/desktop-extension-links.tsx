"use client";

import { Blocks, Puzzle } from "lucide-react";
import Link from "next/link";

import { useDesktopCopy } from "@/lib/desktop-copy";

export function DesktopExtensionLinks() {
  const { copy } = useDesktopCopy();
  const filters = copy.marketplace.filters;

  return (
    <nav className="desktop-extension-links" aria-label={copy.marketplace.headerTitle}>
      <Link href="/desktop-app/marketplace/">
        <Puzzle aria-hidden="true" />
        <span>{copy.marketplace.headerTitle}<small>{filters.mcp} / {filters.skill} / {filters.plugin}</small></span>
      </Link>
      <Link href="/desktop-app/mcp/">
        <Blocks aria-hidden="true" />
        <span>{copy.chrome.sidebar.mcp}</span>
      </Link>
    </nav>
  );
}
