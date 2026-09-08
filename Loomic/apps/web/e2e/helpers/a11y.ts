// @a11y — Axe-core integration for E2E tests.
// Wraps @axe-core/playwright so spec files just call `auditA11y(page)`.
import { expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * Audit a page against WCAG 2.1 AA + best practices.
 * Fails the test on any violation and dumps a summary into the report.
 */
export async function auditA11y(
  page: Page,
  options: { include?: string; exclude?: string[] } = {},
) {
  const builder = new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"]);

  if (options.include) builder.include(options.include);
  if (options.exclude) {
    for (const sel of options.exclude) builder.exclude(sel);
  }

  const results = await builder.analyze();

  if (results.violations.length > 0) {
    const summary = results.violations
      .map(
        (v) =>
          `• [${v.impact ?? "unknown"}] ${v.id}\n  ${v.help}\n  ${v.nodes.length} node(s)`,
      )
      .join("\n\n");
    console.log(`\n[axe] Violations on ${page.url()}:\n${summary}\n`);
  }

  expect(results.violations, "Axe accessibility audit passed").toEqual([]);
}
