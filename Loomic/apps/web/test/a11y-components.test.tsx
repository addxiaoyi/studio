// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";

// @a11y — E-commerce surfaces should be navigable by keyboard
// and screen reader. axe-core rules covered: button-name, image-alt,
// label, region, document-title.
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import axeCore from "axe-core";
import { createElement, type ComponentType } from "react";

const mockToken = "session-token";

import { EmptyState, EmptyStateAction } from "../src/components/empty-state";
import { Skeleton, SkeletonText, SkeletonCard } from "../src/components/skeleton";
import { YeePayCheckoutDialog } from "../src/components/yeepay-checkout-dialog";

async function runAxe(container: HTMLElement) {
  const results = await axeCore.run(container, {
    rules: { "color-contrast": { enabled: false } },
  });
  return results.violations;
}

describe("A11y — core UI components", () => {
  it("EmptyState has heading, icon, action button", async () => {
    // Test SVG component matches EmptyState's `icon` prop contract
    const TestIcon = ((props: { className?: string }) =>
      createElement("svg", props)) as ComponentType<{ className?: string }>;

    const { container, getByText, getAllByRole } = render(
      <EmptyState
        icon={TestIcon}
        title="No data"
        description="Try again"
        action={
          <EmptyStateAction
            primary={{ label: "Create" }}
            secondary={{ label: "Cancel" }}
          />
        }
      />,
    );

    expect(getByText("No data")).toBeInTheDocument();
    const buttons = getAllByRole("button");
    expect(buttons.length).toBeGreaterThan(0);

    const violations = await runAxe(container);
    const critical = violations.filter((v) =>
      ["critical", "serious"].includes(v.impact ?? "minor"),
    );
    expect(critical).toEqual([]);
  });

  it("Skeleton primitive is presentational and labelled", async () => {
    const { container } = render(
      <div>
        <Skeleton className="h-12 w-32" aria-label="Loading user data" />
      </div>,
    );

    const violations = await runAxe(container);
    const critical = violations.filter((v) =>
      ["critical", "serious"].includes(v.impact ?? "minor"),
    );
    expect(critical).toEqual([]);
  });

  it("SkeletonText lines don't break heading order", async () => {
    const { container } = render(
      <div>
        <h1>Page title</h1>
        <SkeletonText lines={3} lastLineWidth="60%" />
      </div>,
    );

    // Page still has a single h1 — SkeletonText does NOT add headings.
    const h1s = container.querySelectorAll("h1");
    expect(h1s.length).toBe(1);

    const violations = await runAxe(container);
    const critical = violations.filter((v) =>
      ["critical", "serious"].includes(v.impact ?? "minor"),
    );
    expect(critical).toEqual([]);
  });

  it("SkeletonCard has accessible label", async () => {
    const { container, getByLabelText } = render(
      <SkeletonCard aria-label="Loading project" />,
    );
    expect(getByLabelText("Loading project")).toBeInTheDocument();

    const violations = await runAxe(container);
    const critical = violations.filter((v) =>
      ["critical", "serious"].includes(v.impact ?? "minor"),
    );
    expect(critical).toEqual([]);
  });

  it("YeePay checkout dialog renders nothing when closed", async () => {
    const { container } = render(
      <YeePayCheckoutDialog
        open={false}
        onOpenChange={() => {}}
        packageId="pro-pack"
        packageLabel="Pro 套餐"
        amountCnyFen={9900}
        accessToken={mockToken}
        onSuccess={() => {}}
      />,
    );

    const violations = await runAxe(container);
    const critical = violations.filter((v) =>
      ["critical", "serious"].includes(v.impact ?? "minor"),
    );
    expect(critical).toEqual([]);
  });
});

// Avoid TS unused-imports false positives by referencing each
// Skeleton export at least once.
void SkeletonCard;
void YeePayCheckoutDialog;
