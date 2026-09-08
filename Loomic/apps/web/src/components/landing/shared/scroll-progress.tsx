"use client";

import { motion, useScroll, useSpring } from "framer-motion";

/**
 * ScrollProgress — a thin glass progress bar pinned to the top of the page.
 * Animates the width as the user scrolls down, giving the site a
 * "documented reading" feel. Spring-smoothed to avoid jitter on
 * trackpad inertial scrolls.
 *
 * Usage: drop at the top of the hero. The hero is full-viewport so it
 * naturally appears on first paint.
 */
export function ScrollProgress() {
  const { scrollYProgress } = useScroll();
  const scaleX = useSpring(scrollYProgress, {
    stiffness: 120,
    damping: 24,
    mass: 0.2,
  });

  return (
    <motion.div
      aria-hidden
      className="fixed top-0 left-0 right-0 h-[2px] z-50 origin-left"
      style={{ scaleX, background: "oklch(var(--foreground) / 0.85)" }}
    />
  );
}
