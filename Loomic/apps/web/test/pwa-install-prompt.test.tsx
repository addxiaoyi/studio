// @ui-system — PWA install prompt smoke tests
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { PWAInstallPrompt } from "../src/components/pwa-install-prompt.js";

describe("PWAInstallPrompt", () => {
  it("renders nothing when beforeinstallprompt has not fired", () => {
    const { container } = render(<PWAInstallPrompt />);
    expect(container.firstChild).toBeNull();
  });

  it("does not throw in jsdom (no beforeinstallprompt event)", () => {
    expect(() => render(<PWAInstallPrompt />)).not.toThrow();
  });
});
