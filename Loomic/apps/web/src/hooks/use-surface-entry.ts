"use client";
import { useCallback, useRef } from "react";
import gsap from "gsap";
export function useSurfaceEntry<T extends HTMLElement>(key: unknown = "mount") {
  const tween = useRef<gsap.core.Tween | null>(null);
  const previous = useRef<T | null>(null);
  // A route key deliberately reattaches the callback to start a fresh entry.
  // biome-ignore lint/correctness/useExhaustiveDependencies: The key is a ref lifecycle trigger.
  return useCallback(
    (node: T | null) => {
      tween.current?.kill();
      if (previous.current)
        gsap.set(previous.current, { clearProps: "opacity" });
      previous.current = node;
      if (!node) return;
      const reduced = window.matchMedia?.(
        "(prefers-reduced-motion: reduce)",
      ).matches;
      // Opacity keeps fixed editor overlays in the viewport's coordinate system.
      tween.current = gsap.fromTo(
        node,
        { opacity: reduced ? 1 : 0 },
        {
          opacity: 1,
          duration: reduced ? 0 : 0.16,
          clearProps: "opacity",
          overwrite: true,
        },
      );
    },
    [key],
  );
}
