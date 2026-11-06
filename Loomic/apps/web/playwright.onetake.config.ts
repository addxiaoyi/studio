import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e", testMatch: "onetake-live.spec.ts", workers: 1, timeout: 240_000,
  outputDir: "../../.creative-test-results/onetake-browser",
  reporter: [["list"], ["json", { outputFile: "../../.creative-test-results/onetake-browser-report.json" }]],
  webServer: {
    command: "node node_modules/next/dist/bin/next dev -p 3217 --hostname 127.0.0.1",
    url: "http://localhost:3217/login/", env: { NEXT_PUBLIC_SERVER_BASE_URL: "http://localhost:3312" }, reuseExistingServer: false, timeout: 120_000,
  },
  use: { baseURL: "http://localhost:3217", browserName: "chromium", actionTimeout: 15_000, viewport: { width: 1280, height: 900 }, screenshot: "only-on-failure", trace: "retain-on-failure" },
});
