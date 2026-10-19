"use client";

import { X } from "lucide-react";
import { createPortal } from "react-dom";
import { useEffect, useRef } from "react";

export function EcomImagePreviewDialog({ src, onClose }: { src: string; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previousFocusRef.current?.focus();
    };
  }, [onClose]);

  return createPortal(
    <div role="dialog" aria-modal="true" aria-label="查看生成原图" className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4" onClick={onClose}>
      <button ref={closeRef} type="button" aria-label="关闭预览" onClick={onClose} className="absolute right-5 top-5 flex size-10 items-center justify-center rounded-full bg-white/10 text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white hover:bg-white/20"><X className="size-5" aria-hidden="true" /></button>
      <img src={src} alt="生成结果原尺寸预览" className="max-h-[92vh] max-w-[92vw] object-contain" onClick={(event) => event.stopPropagation()} />
    </div>,
    document.body,
  );
}
