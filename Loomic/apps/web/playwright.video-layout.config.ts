import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e", testMatch: "video-layout.spec.ts", workers: 1, timeout: 180_000,
  outputDir: "../../.creative-test-results/video-layout",
  reporter: [["list"], ["json", { outputFile: "../../.creative-test-results/video-layout-report.json" }]],
  webServer: { command: "node node_modules/next/dist/bin/next dev -p 3219 --hostname 127.0.0.1", url: "http://localhost:3219/login/", env: { NEXT_PUBLIC_SERVER_BASE_URL: "http://localhost:3311" }, reuseExistingServer: false, timeout: 120_000 },
  use: { baseURL: "http://localhost:3219", browserName: "chromium" },
});
