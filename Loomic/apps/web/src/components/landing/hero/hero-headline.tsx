"use client";

import { motion } from "framer-motion";
import { TypewriterText, useTypewriter } from "@/components/landing/typewriter";
import { fadeUp, blurIn } from "@/components/landing/motion";
import { useEffect, useState } from "react";

/**
 * HeroHeadline — the editorial-style headline that types in on first paint,
 * then reveals a short "Enterprise AI Canvas Studio" subtitle and a
 * one-paragraph pitch below. Owns its own internal "show" state so the
 * animation plays in sequence.
 */
export function HeroHeadline() {
  const { isComplete } = useTypewriter({
    text: "设计团队的 AI 画布工作台",
    speed: 70,
    delay: 200,
  });
  const [showSub, setShowSub] = useState(false);

  // Compute the total typewriter duration locally so the subtitle fades in
  // ~400ms after the headline finishes, regardless of any future tweaks.
  const chars = "设计团队的 AI 画布工作台".length;
  const typewriterEnd = 200 + chars * 70;
  const subtitleDelay = typewriterEnd + 400;
  const descDelay = (subtitleDelay + 200) / 1000;
  const ctaDelay = (subtitleDelay + 400) / 1000;

  useEffect(() => {
    if (isComplete) {
      const t = setTimeout(() => setShowSub(true), 400);
      return () => clearTimeout(t);
    }
  }, [isComplete]);

  return (
    <>
      <motion.h1
        variants={fadeUp}
        initial="hidden"
        animate="visible"
        transition={{ delay: 0.1 }}
        className="mt-12 display-xl text-foreground"
      >
        <TypewriterText text="设计团队的 AI 画布工作台" speed={70} delay={200} />
      </motion.h1>

      <motion.p
        variants={blurIn}
        initial="hidden"
        animate={showSub ? "visible" : "hidden"}
        className="mt-6 text-xs md:text-sm text-muted-foreground font-light tracking-[0.32em] uppercase"
      >
        Enterprise AI Canvas Studio
      </motion.p>

      <motion.p
        variants={fadeUp}
        initial="hidden"
        animate="visible"
        transition={{ delay: descDelay }}
        className="mt-10 body-relaxed max-w-xl mx-auto"
      >
        一个无限画布，AI 直接生成图片、视频、文案并自动遵循品牌规范。
        设计师、文案、运营、市场在同一个画布上协作，所有产出始终统一调性。
      </motion.p>

      {/* Pre-computed delay exposed via data-attr for the CTAs */}
      <span data-cta-delay={ctaDelay} hidden />
    </>
  );
}
