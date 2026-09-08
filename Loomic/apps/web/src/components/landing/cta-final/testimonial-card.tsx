"use client";

import { Star } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Testimonial } from "./testimonials-data";

/**
 * TestimonialCard — a glass-framed quote card.
 * Used in the final-CTA section.
 */
export function TestimonialCard({ t }: { t: Testimonial }) {
  return (
    <div className="glass rounded-2xl p-8 space-y-6 h-full flex flex-col">
      <div className="flex gap-1">
        {Array.from({ length: 5 }, (_, i) => (
          <Star
            key={i}
            className="size-3 fill-foreground/40 text-foreground/40"
          />
        ))}
      </div>
      <p className="text-base leading-relaxed text-foreground/85 font-light flex-1">
        &ldquo;{t.quote}&rdquo;
      </p>
      <div>
        <p className="text-sm font-medium">{t.author}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{t.role}</p>
      </div>
    </div>
  );
}
