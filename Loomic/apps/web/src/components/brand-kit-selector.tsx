"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";

import type { BrandKitSummary } from "@helstera/shared";
import { fetchBrandKits } from "@/lib/brand-kit-api";
import { updateProject } from "@/lib/server-api";
import { t, useLocale } from "@/lib/i18n";

interface BrandKitSelectorProps {
  accessToken: string;
  projectId: string;
  currentBrandKitId: string | null;
  onBrandKitChange: (kitId: string | null) => void;
}

export function BrandKitSelector({
  accessToken,
  projectId,
  currentBrandKitId,
  onBrandKitChange,
}: BrandKitSelectorProps) {
  const copy = t(useLocale()).brandKit;
  const [kits, setKits] = useState<BrandKitSummary[]>([]);
  const [open, setOpen] = useState(false);
  const [updating, setUpdating] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Use a ref for accessToken to prevent tab-switch reload cascades.
  const accessTokenRef = useRef(accessToken);
  accessTokenRef.current = accessToken;

  // Fetch brand kits on mount
  useEffect(() => {
    let cancelled = false;
    fetchBrandKits(accessTokenRef.current)
      .then((res) => {
        if (!cancelled) setKits(res.brandKits);
      })
      .catch(() => {
        /* silently ignore – selector stays empty */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const currentKit = kits.find((k) => k.id === currentBrandKitId);
  const label = currentKit ? currentKit.name : `${copy.label}: ${copy.none}`;

  const handleSelect = useCallback(
    async (kitId: string | null) => {
      if (kitId === currentBrandKitId) {
        setOpen(false);
        return;
      }
      setUpdating(true);
      try {
        await updateProject(accessTokenRef.current, projectId, {
          brand_kit_id: kitId,
        });
        onBrandKitChange(kitId);
      } catch {
        /* keep current state on failure */
      } finally {
        setUpdating(false);
        setOpen(false);
      }
    },
    [projectId, currentBrandKitId, onBrandKitChange],
  );

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        disabled={updating}
        onClick={() => setOpen((v) => !v)}
        aria-label={`品牌套件：${label}`}
        aria-expanded={open}
        className="flex max-w-[min(160px,35vw)] items-center gap-1.5 rounded-full glass-soft border border-border/40 px-3 py-1.5 text-sm transition-all duration-300 hover:glass focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
      >
        <span className="max-w-[min(120px,28vw)] truncate font-light text-foreground/80">
          {label}
        </span>
        <ChevronDown
          className="h-3.5 w-3.5 shrink-0 opacity-50"
          strokeWidth={1.5}
        />
      </button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-1.5 min-w-[200px] rounded-2xl glass-strong border border-border/40 shadow-card-hover p-1.5">
          {/* Unbind option */}
          <button
            type="button"
            onClick={() => handleSelect(null)}
            className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm hover:bg-foreground/[0.04] transition-all duration-300 cursor-pointer"
          >
            <span className="h-4 w-4 shrink-0">
              {currentBrandKitId === null && (
                <Check className="h-4 w-4 text-foreground" strokeWidth={1.5} />
              )}
            </span>
            <span className="font-light text-foreground/80">{copy.none}</span>
          </button>

          {/* Kit list */}
          {kits.map((kit) => (
            <button
              key={kit.id}
              type="button"
              onClick={() => handleSelect(kit.id)}
              className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm hover:bg-foreground/[0.04] transition-all duration-300 cursor-pointer"
            >
              <span className="h-4 w-4 shrink-0">
                {kit.id === currentBrandKitId && (
                  <Check
                    className="h-4 w-4 text-foreground"
                    strokeWidth={1.5}
                  />
                )}
              </span>
              <span className="truncate font-light text-foreground/80">
                {kit.name}
              </span>
            </button>
          ))}

          {kits.length === 0 && (
            <p className="px-3 py-2 text-sm text-muted-foreground font-light">
              {copy.empty}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
