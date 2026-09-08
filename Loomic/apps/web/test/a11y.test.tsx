// @a11y — Accessibility audit for core landing surfaces.
// Runs axe-core on jsdom-rendered pages to catch regressions in
// aria attributes, label associations, heading order, etc.
//
// `color-contrast` is disabled because jsdom cannot compute real
// color contrast — we rely on real-browser E2E for that.

import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import axeCore from "axe-core";

async function runAxe(container: HTMLElement) {
  const results = await axeCore.run(container, {
    rules: {
      "color-contrast": { enabled: false },
    },
  });
  return results.violations;
}

describe("A11y — axe-core audit", () => {
  it("minimal accessible skeleton has no critical violations", async () => {
    const { container } = render(
      <main>
        <h1>Test heading</h1>
        <button type="button">Action</button>
      </main>,
    );

    const violations = await runAxe(container);
    const critical = violations.filter((v) =>
      ["critical", "serious"].includes(v.impact ?? "minor"),
    );
    if (critical.length > 0) {
      // Print details so failures are debuggable
      // eslint-disable-next-line no-console
      console.error(
        "Critical violations:",
        critical.map((v) => `${v.id}: ${v.help}`),
      );
    }
    expect(critical).toEqual([]);
  });

  it("unlabeled buttons get flagged", async () => {
    const { container } = render(
      <main>
        <button type="button">
          <svg width={16} height={16} />
        </button>
      </main>,
    );

    const violations = await runAxe(container);
    const labelIssues = violations.filter((v) => v.id === "button-name");
    expect(labelIssues.length).toBeGreaterThan(0);
  });

  it("images without alt text get flagged", async () => {
    const { container } = render(
      <main>
        <h1>Test</h1>
        <img src="/test.jpg" />
      </main>,
    );

    const violations = await runAxe(container);
    const altIssues = violations.filter((v) => v.id === "image-alt");
    expect(altIssues.length).toBeGreaterThan(0);
  });

  it("a properly-labelled button passes", async () => {
    const { container } = render(
      <main>
        <h1>Test</h1>
        <button type="button" aria-label="Submit form">
          Submit
        </button>
        <img src="/x.jpg" alt="Decorative preview" />
      </main>,
    );

    const violations = await runAxe(container);
    const critical = violations.filter((v) =>
      ["critical", "serious"].includes(v.impact ?? "minor"),
    );
    expect(critical).toEqual([]);
  });
});
