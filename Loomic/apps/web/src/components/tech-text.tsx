"use client";

import { motion, useReducedMotion } from "framer-motion";

export function TechText({ text, className = "" }: { text: string; className?: string }) {
  const reduced = useReducedMotion();
  return <span className={`inline-flex flex-wrap justify-center ${className}`} aria-label={text}>{Array.from(text).map((char, index) => <motion.span key={`${char}-${index}`} className="relative inline-block" {...(reduced ? {} : { initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0 }, transition: { delay: index * 0.025, duration: 0.35 }, whileHover: { y: -3, color: "hsl(var(--primary))" } })}>{char === " " ? "\u00a0" : char}</motion.span>)}</span>;
}
