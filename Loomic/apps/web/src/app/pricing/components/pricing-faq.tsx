"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown } from "lucide-react";

import { faqItems, fadeInUp } from "./pricing-data";
import { cn } from "@/lib/utils";

export function PricingFAQ() {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  const toggle = (index: number) => {
    setOpenIndex((prev) => (prev === index ? null : index));
  };

  return (
    <motion.section
      variants={fadeInUp}
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, amount: 0.1 }}
      custom={0}
      className="px-6 py-32"
    >
      {/* Header — editorial */}
      <div className="mx-auto mb-16 max-w-3xl text-center">
        <span className="eyebrow">FAQ</span>
        <h2 className="display-md mt-5 text-foreground">常见问题</h2>
        <p className="body-relaxed mt-5">
          关于 Helstera 方案、计费与安全的常见问题
        </p>
      </div>

      {/* Accordion — glass container */}
      <div className="glass border border-border/40 mx-auto max-w-3xl overflow-hidden rounded-[1.5rem]">
        {faqItems.map((item, index) => {
          const isOpen = openIndex === index;
          const isLast = index === faqItems.length - 1;

          return (
            <div
              key={item.question}
              className={cn(
                isLast ? "" : "border-b border-border/30",
              )}
            >
              {/* Question row */}
              <button
                type="button"
                onClick={() => toggle(index)}
                className="hover:bg-foreground/[0.02] flex w-full cursor-pointer items-center justify-between px-6 py-5 text-left transition-all duration-300"
              >
                <span className="text-foreground text-base font-medium tracking-tight pr-4">
                  {item.question}
                </span>
                <motion.span
                  animate={{ rotate: isOpen ? 180 : 0 }}
                  transition={{ duration: 0.25, ease: "easeOut" }}
                  className="text-muted-foreground/60 shrink-0"
                >
                  <ChevronDown className="size-4" strokeWidth={1.5} />
                </motion.span>
              </button>

              {/* Answer */}
              <AnimatePresence initial={false}>
                {isOpen && (
                  <motion.div
                    key="answer"
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.3, ease: [0.25, 0.46, 0.45, 0.94] }}
                    className="overflow-hidden"
                  >
                    <p className="text-muted-foreground px-6 pb-6 text-sm font-light leading-relaxed">
                      {item.answer}
                    </p>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>
    </motion.section>
  );
}
