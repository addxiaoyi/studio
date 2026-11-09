import { defineConfig } from "@playwright/test";
const staticRoot = process.env.HELT_STUDIO_STATIC_ROOT;
export default defineConfig({
  testDir: "./e2e", testMatch: ["studio-health.spec.ts", "studio-export-stress.spec.ts"], workers: 1, timeout: 720_000,
  outputDir: "../../.creative-test-results/studio-health",
  reporter: [["list"], ["json", { outputFile: "../../.creative-test-results/studio-health.json" }]],
  webServer: {
    command: staticRoot ? "node ../../scripts/serve-workflow-candidate.mjs" : "node node_modules/next/dist/bin/next dev -p 3234 --hostname 127.0.0.1",
    url: "http://localhost:3234/login/", env: { NEXT_PUBLIC_SERVER_BASE_URL: "http://localhost:3311", ...(staticRoot ? { HELT_WORKFLOW_STATIC_ROOT: staticRoot, HELT_WORKFLOW_STATIC_PORT: "3234", HELT_WORKFLOW_API_PORT: "3311" } : {}) },
    reuseExistingServer: false, timeout: 120_000,
  },
  use: { baseURL: "http://localhost:3234", browserName: "chromium", viewport: { width: 1440, height: 960 }, actionTimeout: 20_000 },
});
