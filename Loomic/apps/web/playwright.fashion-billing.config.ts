import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e",
  testMatch: "fashion-billing-controls.spec.ts",
  workers: 1,
  timeout: 120000,
  outputDir: "../../.creative-test-results/fashion-billing",
  reporter: [
    ["list"],
    [
      "json",
      { outputFile: "../../.creative-test-results/fashion-billing.json" },
    ],
  ],
  webServer: {
    command:
      "node node_modules/next/dist/bin/next dev -p 3225 --hostname 127.0.0.1",
    url: "http://localhost:3225/login/",
    env: { NEXT_PUBLIC_SERVER_BASE_URL: "http://localhost:3311" },
    reuseExistingServer: false,
    timeout: 120000,
  },
  use: {
    baseURL: "http://localhost:3225",
    browserName: "chromium",
    viewport: { width: 1280, height: 960 },
    actionTimeout: 15000,
  },
});
