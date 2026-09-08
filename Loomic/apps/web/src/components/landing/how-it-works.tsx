"use client";

/**
 * HowItWorks — 4-step onboarding flow.
 *
 *   <SectionHeader />  heading
 *   <StepCard /> × 4   glass card grid
 *
 * Step copy lives in steps/steps-data.tsx.
 */

import { SectionHeader } from "@/components/landing/section-header";
import { StaggerContainer } from "@/components/landing/motion";
import { STEPS, type Step } from "./steps/steps-data";
import { StepCard } from "./steps/step-card";

// Re-export for tests
export type { Step };

export function HowItWorks() {
  return (
    <section className="py-32 md:py-40">
      <div className="max-w-6xl mx-auto px-6">
        <div className="mb-24 md:mb-32">
          <SectionHeader
            title="四步开启企业 AI 创作"
            subtitle="从品牌资产到内容发布，一站式工作流"
          />
        </div>

        <StaggerContainer className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {STEPS.map((step) => (
            <StepCard key={step.number} step={step} />
          ))}
        </StaggerContainer>
      </div>
    </section>
  );
}
