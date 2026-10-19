"use client";

import { useLayoutEffect, useMemo, useRef } from "react";
import { gsap } from "gsap";

import "./stroke-text.css";

type StrokeTextProps = {
  text: string;
  className?: string;
  strokeColor?: string;
  fillColor?: string;
  strokeWidth?: number;
  fontSize?: number;
  fontWeight?: number | string;
  letterSpacing?: number;
  drawDuration?: number;
  stagger?: number;
  trigger?: "mount" | "hover" | "loop";
  decorative?: boolean;
};

export function StrokeText({
  text,
  className = "",
  strokeColor = "currentColor",
  fillColor = "currentColor",
  strokeWidth = 1.2,
  fontSize = 128,
  fontWeight = 800,
  letterSpacing = -4,
  drawDuration = 0.8,
  stagger = 0.04,
  trigger = "mount",
  decorative = false,
}: StrokeTextProps) {
  const rootRef = useRef<HTMLSpanElement>(null);
  const charRefs = useRef<Array<HTMLSpanElement | null>>([]);
  const characters = useMemo(() => Array.from(text), [text]);

  useLayoutEffect(() => {
    const root = rootRef.current;
    const chars = charRefs.current.filter((char): char is HTMLSpanElement => Boolean(char));
    if (!root || chars.length === 0) return undefined;

    const prefersReducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const timeline = gsap.timeline({
      paused: true,
      repeat: trigger === "loop" ? -1 : 0,
      repeatDelay: 1.2,
      yoyo: trigger === "loop",
    });
    const endState = { opacity: 1, y: 0, color: fillColor };

    gsap.set(chars, { opacity: 0, y: 10, color: strokeColor });
    if (prefersReducedMotion) {
      gsap.set(chars, endState);
      return () => gsap.killTweensOf(chars);
    }

    timeline.to(chars, {
      ...endState,
      duration: Math.max(0.2, drawDuration),
      ease: "power2.out",
      stagger,
    });

    let disposed = false;
    const play = () => timeline.restart();
    if (trigger === "hover") {
      gsap.set(chars, endState);
      root.addEventListener("pointerenter", play);
    } else {
      const start = () => {
        if (!disposed) timeline.play(0);
      };
      if (document.fonts?.ready) {
        document.fonts.ready.then(start).catch(start);
      } else {
        start();
      }
    }

    return () => {
      disposed = true;
      root.removeEventListener("pointerenter", play);
      timeline.kill();
      gsap.killTweensOf(chars);
    };
  }, [drawDuration, fillColor, stagger, strokeColor, text, trigger]);

  return (
    <span
      ref={rootRef}
      className={`stroke-text ${trigger === "hover" ? "stroke-text--hover" : ""} ${className}`.trim()}
      style={{
        fontSize,
        fontWeight,
        letterSpacing,
        WebkitTextStroke: `${strokeWidth}px ${strokeColor}`,
        color: fillColor,
      }}
      role={decorative ? undefined : "img"}
      aria-hidden={decorative ? true : undefined}
      aria-label={decorative ? undefined : text}
    >
      {characters.map((character, index) => (
        <span
          key={`${character}-${index}`}
          ref={(element) => {
            charRefs.current[index] = element;
          }}
          className="stroke-text__char"
          style={{ WebkitTextStroke: `${strokeWidth}px ${strokeColor}` }}
        >
          {character === " " ? "\u00a0" : character}
        </span>
      ))}
    </span>
  );
}
