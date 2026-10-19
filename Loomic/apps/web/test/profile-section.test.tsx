// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ProfileSection } from "../src/components/profile-section";

describe("ProfileSection", () => {
  afterEach(cleanup);

  it("renders each social platform connection card once", () => {
    render(
      <ProfileSection
        displayName="Test User"
        email="test@example.com"
        onSave={vi.fn()}
        accounts={[]}
        accountBusy={false}
        onBindAccount={vi.fn()}
        onRevokeAccount={vi.fn()}
      />,
    );

    expect(screen.getAllByText("X")).toHaveLength(1);
  });
});
