"use client";

import type { BrandKitAsset } from "@helstera/shared";
import { Image as ImageIcon, Plus, X } from "lucide-react";

import { cn } from "../../lib/utils";
import { InlineInput } from "./inline-input";

// --- AssetCard ---

interface AssetCardProps {
  asset: BrandKitAsset;
  onDelete: (assetId: string) => void;
  onUpdateLabel: (assetId: string, name: string) => void;
}

export function AssetCard({ asset, onDelete, onUpdateLabel }: AssetCardProps) {
  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="relative group">
        <div className="w-[150px] h-[113px] rounded-2xl glass-soft border border-border/60 flex items-center justify-center overflow-hidden transition-all group-hover:glass">
          {asset.file_url ? (
            <img
              src={asset.file_url}
              alt={asset.display_name}
              className="h-full w-full object-cover"
            />
          ) : (
            <ImageIcon className="h-8 w-8 text-muted-foreground/40" />
          )}
        </div>
        <button
          type="button"
          onClick={() => onDelete(asset.id)}
          className={cn(
            "absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full glass border border-border/60",
            "flex items-center justify-center",
            "opacity-0 group-hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-foreground/20 transition-all duration-300 cursor-pointer",
          )}
          aria-label={`Delete ${asset.display_name}`}
        >
          <X className="h-3 w-3 text-muted-foreground" />
        </button>
      </div>
      <InlineInput
        value={asset.display_name}
        onCommit={(name) => onUpdateLabel(asset.id, name)}
        className="w-[150px]"
        inputClassName="text-xs text-center text-muted-foreground truncate"
      />
    </div>
  );
}

// --- AddAssetCard ---

interface AddAssetCardProps {
  label: string;
  disabled?: boolean;
  onClick?: () => void;
}

export function AddAssetCard({
  label,
  disabled = false,
  onClick,
}: AddAssetCardProps) {
  return (
    <div className="flex flex-col items-center gap-1.5">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className={cn(
          "w-[150px] h-[113px] rounded-2xl border-2 border-dashed border-border/60",
          "flex items-center justify-center transition-all",
          disabled
            ? "opacity-40 cursor-not-allowed"
            : "hover:border-border hover:glass-soft cursor-pointer",
        )}
        aria-label={label}
      >
        <Plus className="h-5 w-5 text-muted-foreground/60" />
      </button>
      <span className="text-xs text-muted-foreground/60">{label}</span>
    </div>
  );
}
