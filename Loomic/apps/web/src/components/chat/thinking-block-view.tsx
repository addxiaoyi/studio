"use client";

import { AnimatePresence, motion } from "framer-motion";
import React, { useState } from "react";

type ThinkingBlockViewProps = {
  thinking: string;
  isStreaming: boolean;
};

/** Shows a safe high-level thinking status without exposing hidden chain-of-thought. */
export const ThinkingBlockView = React.memo(function ThinkingBlockView({
  thinking,
  isStreaming,
}: ThinkingBlockViewProps) {
  const [expanded, setExpanded] = useState(false);
  const hasThinking = thinking.trim().length > 0;

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      className="mb-2 overflow-hidden"
    >
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="group flex items-center gap-2 text-xs text-muted-foreground/70 transition-all duration-300 hover:text-foreground"
        aria-expanded={expanded || isStreaming}
        aria-label={isStreaming ? "正在思考" : "切换思考摘要"}
      >
        {isStreaming ? (
          <span className="relative inline-flex items-center gap-2 overflow-hidden rounded-full border border-slate-300/70 bg-slate-100/70 px-2.5 py-1 text-slate-600 shadow-sm dark:border-slate-500/40 dark:bg-slate-800/60 dark:text-slate-300">
            <span className="thinking-shimmer absolute inset-y-0 -left-1/2 w-1/2 bg-gradient-to-r from-transparent via-white/80 to-transparent dark:via-slate-200/25" aria-hidden="true" />
            <span className="relative flex items-center gap-1.5">
              <span className="size-1.5 animate-pulse rounded-full bg-slate-500 dark:bg-slate-300" />
              <span>正在思考</span>
              <span className="tracking-[0.22em] text-slate-400 dark:text-slate-500">•••</span>
            </span>
          </span>
        ) : (
          <>
            <motion.svg width="12" height="12" viewBox="0 0 12 12" fill="none" animate={{ rotate: expanded ? 90 : 0 }} transition={{ duration: 0.2 }}>
              <path d="M4.5 2.5l3.5 3.5-3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </motion.svg>
            <span className="text-slate-500 dark:text-slate-400">思考摘要</span>
          </>
        )}
      </button>

      <AnimatePresence>
        {(expanded || isStreaming) && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.2 }} className="mt-1.5 overflow-hidden">
            <div className="border-l-2 border-slate-300 pl-3 text-xs leading-relaxed text-muted-foreground/70 dark:border-slate-600">
              {isStreaming ? "正在分析你的请求并准备下一步操作。" : hasThinking ? "已完成分析。详细内部推理不会直接展示，但你可以查看后续操作、工具结果和最终答案。" : "已完成分析。"}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
});
