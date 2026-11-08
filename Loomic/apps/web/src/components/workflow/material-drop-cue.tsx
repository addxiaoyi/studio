"use client";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { ImagePlus } from "lucide-react";
import { gsap } from "gsap";
import type { MaterialDropCue } from "./use-material-drop";
import "./workflow-media.css";

export function WorkflowMaterialDropCue({
  cue,
  onComplete,
}: {
  cue: MaterialDropCue | null;
  onComplete(): void;
}) {
  const outline = useRef<HTMLDivElement>(null),
    tile = useRef<HTMLDivElement>(null),
    done = useRef(onComplete);
  done.current = onComplete;
  useEffect(() => {
    if (!cue || !outline.current) return;
    const motion = gsap.matchMedia();
    motion.add(
      {
        reduced: "(prefers-reduced-motion: reduce)",
        normal: "(prefers-reduced-motion: no-preference)",
      },
      (context) => {
        const reduced = Boolean(context.conditions?.reduced);
        gsap.set(outline.current, {
          x: cue.rect.x,
          y: cue.rect.y,
          width: cue.rect.width,
          height: cue.rect.height,
        });
        if (cue.phase !== "embedded") {
          gsap.fromTo(
            outline.current,
            { opacity: 0, scale: reduced ? 1 : 0.98 },
            { opacity: 1, scale: 1, duration: reduced ? 0 : 0.14 },
          );
          return;
        }
        const animation = gsap.timeline({ onComplete: () => done.current() });
        if (tile.current) {
          gsap.set(tile.current, {
            x: cue.from.x - 30,
            y: cue.from.y - 30,
            opacity: 1,
          });
          animation.to(tile.current, {
            x: cue.rect.x + cue.rect.width / 2 - 30,
            y: cue.rect.y + 90,
            scale: 0.55,
            opacity: 0,
            duration: reduced ? 0 : 0.32,
            ease: "power2.inOut",
          });
        }
        animation
          .fromTo(
            outline.current,
            { opacity: 1, scale: 1.015 },
            { scale: 1, duration: reduced ? 0 : 0.2 },
            0,
          )
          .to(
            outline.current,
            { opacity: 0, duration: reduced ? 0 : 0.18 },
            "+=0.65",
          );
      },
    );
    return () => motion.revert();
  }, [cue]);
  if (!cue) return null;
  return createPortal(
    <>
      <div ref={outline} className="workflow-drop-cue" data-phase={cue.phase}>
        <span role="status">{cue.label}</span>
      </div>
      {cue.phase === "embedded" && (
        <div ref={tile} className="workflow-drop-tile" aria-hidden="true">
          <ImagePlus size={28} />
        </div>
      )}
    </>,
    document.body,
  );
}
