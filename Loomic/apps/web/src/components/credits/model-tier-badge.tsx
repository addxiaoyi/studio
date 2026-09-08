// @credits-system — Model tier badge: displays credit cost, plan tier, and lock for inaccessible models
"use client";

import { Lock } from "lucide-react";
import type { SubscriptionPlan } from "@helstera/shared";

interface ModelTierBadgeProps {
  creditCost: number;
  accessible: boolean;
  minTier: SubscriptionPlan;
}

const TIER_BADGE_STYLES: Record<string, string> = {
  free: "",
  starter: "glass-soft border border-border/40 text-muted-foreground/80",
  pro: "glass border border-border/40 text-foreground",
  ultra: "glass-strong border border-border/40 text-foreground",
  business: "glass-strong border border-border/40 text-foreground",
};

export function ModelTierBadge({
  creditCost,
  accessible,
  minTier,
}: ModelTierBadgeProps) {
  const showTierBadge = minTier !== "free";

  return (
    <span className="inline-flex items-center gap-1.5">
      {/* Credit cost */}
      <span className="text-[11px] tabular-nums text-muted-foreground/70 font-light">
        {creditCost} {accessible ? "积分" : "额度"}
      </span>

      {/* Tier badge (if not free) */}
      {showTierBadge && (
        <span
          className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[9px] font-medium uppercase leading-tight tracking-wider ${TIER_BADGE_STYLES[minTier] ?? ""}`}
        >
          {minTier}
        </span>
      )}

      {/* Lock icon if inaccessible */}
      {!accessible && (
        <Lock className="h-3 w-3 text-muted-foreground/60" strokeWidth={1.5} />
      )}
    </span>
  );
}