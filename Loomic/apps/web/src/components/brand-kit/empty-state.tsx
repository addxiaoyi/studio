"use client";

import { Palette, Plus } from "lucide-react";
import {
  EmptyState as BaseEmptyState,
  EmptyStateAction,
} from "@/components/empty-state";

interface EmptyStateProps {
  onCreateKit: () => void;
}

export function EmptyState({ onCreateKit }: EmptyStateProps) {
  return (
    <BaseEmptyState
      icon={Palette}
      title="还没有品牌套件"
      description="创建一个品牌套件，集中管理色板、字体和 Logo。"
      action={
        <EmptyStateAction
          primary={{
            label: "创建品牌套件",
            onClick: onCreateKit,
          }}
        />
      }
      className="min-h-[320px]"
    />
  );
}
