import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "auth-cookie-order.spec.ts",
  workers: 1,
  timeout: 45_000,
  outputDir: "../../.creative-test-results/auth-cookie-browser",
  reporter: [
    ["list"],
    [
      "json",
      { outputFile: "../../.creative-test-results/auth-cookie-browser.json" },
    ],
  ],
  use: {
    browserName: "chromium",
    baseURL: "http://localhost:3001",
    screenshot: "only-on-failure",
    serviceWorkers: "block",
  },
  webServer: {
    command: "node ../../scripts/serve-auth-cookie-fixture.mjs",
    url: "http://localhost:3001",
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
