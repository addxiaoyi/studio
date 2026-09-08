"use client";

/**
 * FeatureShowcase — four left/right alternating feature rows + an
 * enterprise pillars grid at the bottom. Built on top of:
 *
 *   <SectionHeader />       (generic heading)
 *   <FeatureRow />          (per-feature alternation)
 *   <FeatureRowDivider />   (whitespace separator)
 *   <EnterprisePillars />   (3-column trust grid)
 *
 * Data lives in features/features-data.tsx so a marketer can edit
 * copy without touching layout.
 */

import { SectionHeader } from "@/components/landing/section-header";
import {
  FEATURE_ENTRIES,
  type FeatureEntry,
} from "./features/features-data";
import {
  FeatureRow,
  FeatureRowDivider,
} from "./features/feature-row";
import { EnterprisePillars } from "./features/enterprise-pillars";

// Re-export for tests
export type { FeatureEntry };

export function FeatureShowcase() {
  return (
    <section id="features" className="py-32 md:py-40">
      <div className="max-w-6xl mx-auto px-6">
        <div className="mb-32 md:mb-40 max-w-2xl">
          <SectionHeader
            title="为企业设计团队而生"
            subtitle="从创作到协作，从品牌到合规——一个画布解决所有"
            align="left"
          />
        </div>

        <div className="space-y-32 md:space-y-40">
          {FEATURE_ENTRIES.map((entry, i) => (
            <div key={entry.id}>
              {i > 0 && <FeatureRowDivider />}
              <FeatureRow entry={entry} />
            </div>
          ))}
        </div>

        <EnterprisePillars />
      </div>
    </section>
  );
}
