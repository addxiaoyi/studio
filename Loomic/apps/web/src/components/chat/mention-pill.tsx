"use client";

import React from "react";

type MentionPillProps = {
  label: string;
  kind: "image-model" | "brand-kit-asset";
};

export const MentionPill = React.memo(function MentionPill({
  label,
  kind,
}: MentionPillProps) {
  return (
    <span className="inline-flex h-[22px] items-center gap-1 rounded-md px-1.5 mx-0.5 border border-border/40 glass-soft text-foreground align-middle">
      <span className="text-[10px] leading-none text-muted-foreground/70 uppercase tracking-wider">
        {kind === "image-model" ? "Model" : "Brand"}
      </span>
      <span className="max-w-[120px] truncate text-[11px] leading-none text-foreground/90">
        {label}
      </span>
    </span>
  );
});
