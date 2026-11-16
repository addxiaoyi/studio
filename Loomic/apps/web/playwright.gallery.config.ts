import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "gallery-media.spec.ts",
  workers: 1,
  timeout: 60_000,
  outputDir: "../../.creative-test-results/gallery-browser",
  reporter: [
    ["list"],
    [
      "json",
      { outputFile: "../../.creative-test-results/gallery-browser.json" },
    ],
  ],
  use: {
    browserName: "chromium",
    viewport: { width: 1280, height: 900 },
    screenshot: "only-on-failure",
    serviceWorkers: "block",
  },
});
