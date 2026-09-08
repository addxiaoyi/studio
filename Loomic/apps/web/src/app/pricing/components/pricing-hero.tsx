"use client";

import { motion } from "framer-motion";
import { fadeInUp } from "./pricing-data";

export function PricingHero() {
  return (
    <section className="flex flex-col items-center px-6 pt-40 pb-20">
      <motion.span
        variants={fadeInUp}
        initial="hidden"
        animate="visible"
        custom={0}
        className="mb-6 eyebrow"
      >
        积分充值
      </motion.span>

      <motion.h1
        variants={fadeInUp}
        initial="hidden"
        animate="visible"
        custom={1}
        className="display-lg text-center max-w-3xl"
      >
        用多少买多少，永久有效
      </motion.h1>

      <motion.p
        variants={fadeInUp}
        initial="hidden"
        animate="visible"
        custom={2}
        className="mt-6 body-relaxed max-w-lg text-center"
      >
        一次性购买积分，永久有效。所有 AI 模型通用，模型差异化定价，按需使用不浪费。
      </motion.p>

      {/* Trust strip */}
      <motion.div
        variants={fadeInUp}
        initial="hidden"
        animate="visible"
        custom={3}
        className="mt-12 flex flex-wrap items-center justify-center gap-x-8 gap-y-2 text-sm text-muted-foreground"
      >
        {["无月费", "永不过期", "30 天可退", "所有 AI 模型"].map((item) => (
          <span key={item} className="inline-flex items-center gap-2">
            <svg
              className="size-3.5 text-accent"
              fill="currentColor"
              viewBox="0 0 20 20"
            >
              <path
                fillRule="evenodd"
                d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z"
                clipRule="evenodd"
              />
            </svg>
            <span className="text-foreground/70">{item}</span>
          </span>
        ))}
      </motion.div>
    </section>
  );
}
