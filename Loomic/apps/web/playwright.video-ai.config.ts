import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "video-ai-live.spec.ts",
  outputDir: "../../.creative-test-results/video-ai-live",
  workers: 1,
  timeout: 180_000,
  reporter: [["list"], ["json", { outputFile: "../../.creative-test-results/video-ai-report.json" }]],
  webServer: {
    command: "node node_modules/next/dist/bin/next dev -p 3216 --hostname 127.0.0.1",
    url: "http://localhost:3216/login/",
    env: { NEXT_PUBLIC_SERVER_BASE_URL: "http://localhost:3311" },
    reuseExistingServer: false,
    timeout: 120_000,
  },
  use: { baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3216", browserName: "chromium" },
});
