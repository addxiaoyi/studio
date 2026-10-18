"use client";

import { Palette, Plus } from "lucide-react";
import {
  EmptyState as BaseEmptyState,
  EmptyStateAction,
} from "@/components/empty-state";
import { t, useLocale } from "@/lib/i18n";

interface EmptyStateProps {
  onCreateKit: () => void;
}

export function EmptyState({ onCreateKit }: EmptyStateProps) {
  const copy = t(useLocale()).brandKit;
  return (
    <BaseEmptyState
      icon={Palette}
      title={copy.emptyTitle}
      description={copy.emptyDescription}
      action={
        <EmptyStateAction
          primary={{
            label: copy.create,
            onClick: onCreateKit,
          }}
        />
      }
      className="min-h-[320px]"
    />
  );
}
