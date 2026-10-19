"use client";

import { Check, ChevronDown } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

export type SelectOption = {
  value: string;
  label: string;
  note?: string | undefined;
  badge?: string | undefined;
};

type StyledSelectProps = {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
};

export function StyledSelect({
  value,
  options,
  onChange,
  disabled = false,
  className = "",
  "aria-label": ariaLabel,
}: StyledSelectProps) {
  const [open, setOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const instanceId = useId().replaceAll(":", "");
  const listboxId = `${instanceId}-listbox`;
  const active = options.find((option) => option.value === value) ?? options[0];
  const currentIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );

  useEffect(() => {
    if (!open) return;
    setHighlightedIndex(currentIndex);
    const close = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [currentIndex, open]);

  function select(valueToSet: string) {
    onChange(valueToSet);
    setOpen(false);
    triggerRef.current?.focus();
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "Escape") {
      setOpen(false);
      triggerRef.current?.focus();
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (!open) {
        setHighlightedIndex(currentIndex);
        setOpen(true);
      } else {
        const option = options[highlightedIndex];
        if (option) select(option.value);
      }
      return;
    }
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      if (!open) {
        setHighlightedIndex(currentIndex);
        setOpen(true);
        return;
      }
      const nextIndex =
        event.key === "ArrowDown"
          ? Math.min(options.length - 1, highlightedIndex + 1)
          : event.key === "ArrowUp"
            ? Math.max(0, highlightedIndex - 1)
            : event.key === "Home"
              ? 0
              : options.length - 1;
      setHighlightedIndex(nextIndex);
    }
  }

  return (
    <div ref={rootRef} className={`relative w-full ${className}`}>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled || options.length === 0}
        role="combobox"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-activedescendant={open ? `${listboxId}-option-${highlightedIndex}` : undefined}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={onKeyDown}
        className="flex h-11 w-full items-center justify-between gap-3 rounded-xl border border-input-border bg-background px-3 text-left text-sm text-foreground shadow-sm transition-colors hover:border-foreground/30 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate">{active?.label ?? "暂无选项"}</span>
          {active?.badge && (
            <span className="shrink-0 rounded-md bg-foreground/8 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
              {active.badge}
            </span>
          )}
        </span>
        <ChevronDown
          className={`size-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && options.length > 0 && (
        <div
          id={listboxId}
          role="listbox"
          aria-label={ariaLabel}
          className="absolute left-0 right-0 top-[calc(100%+6px)] z-50 max-h-72 overflow-y-auto rounded-xl border border-border/60 bg-popover p-1.5 text-popover-foreground shadow-xl ring-1 ring-black/5 dark:ring-white/10"
        >
          {options.map((option) => {
            const selected = option.value === value;
            const highlighted = options[highlightedIndex]?.value === option.value;
            return (
              <button
                key={option.value}
                id={`${listboxId}-option-${options.indexOf(option)}`}
                type="button"
                role="option"
                aria-selected={selected}
                tabIndex={-1}
                onMouseEnter={() => setHighlightedIndex(options.indexOf(option))}
                onClick={() => select(option.value)}
                className={`flex min-h-9 w-full items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-left text-sm transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none ${highlighted ? "bg-muted" : ""}`}
              >
                <span className="min-w-0">
                  <span className="flex items-center gap-2">
                    <span className="truncate">{option.label}</span>
                    {option.badge && (
                      <span className="shrink-0 rounded-md bg-foreground/8 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                        {option.badge}
                      </span>
                    )}
                  </span>
                  {option.note && (
                    <span className="mt-0.5 block truncate text-xs font-normal text-muted-foreground">
                      {option.note}
                    </span>
                  )}
                </span>
                {selected && (
                  <Check className="size-4 shrink-0 text-foreground" />
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
