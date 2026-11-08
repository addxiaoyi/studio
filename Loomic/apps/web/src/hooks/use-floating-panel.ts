"use client";
import { useLayoutEffect, useRef, useState } from "react";
import gsap from "gsap";

export function useFloatingPanel(
  open: boolean,
  direction: "left" | "bottom" = "left",
) {
  const ref = useRef<HTMLElement>(null),
    [present, setPresent] = useState(open),
    entered = useRef(false);
  useLayoutEffect(() => {
    if (open && !present) {
      setPresent(true);
      return;
    }
    const panel = ref.current;
    if (!panel) return;
    gsap.killTweensOf(panel);
    const reduced =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (open) {
      if (!entered.current)
        gsap.set(panel, {
          opacity: 0,
          ...(direction === "left" ? { x: -12 } : { y: 12 }),
        });
      entered.current = true;
      const tween = gsap.to(panel, {
        opacity: 1,
        x: 0,
        y: 0,
        duration: reduced ? 0 : 0.22,
        ease: "power2.out",
        overwrite: true,
        clearProps: "transform,opacity",
      });
      return () => {
        tween.kill();
      };
    }
    const tween = gsap.to(panel, {
      opacity: 0,
      ...(direction === "left" ? { x: -8 } : { y: 8 }),
      duration: reduced ? 0 : 0.14,
      ease: "power2.in",
      overwrite: true,
      onComplete: () => {
        entered.current = false;
        setPresent(false);
      },
    });
    return () => {
      tween.kill();
    };
  }, [open, present, direction]);
  return { ref, present };
}
