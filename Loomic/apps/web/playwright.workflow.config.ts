import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e",
  testMatch: ["canvas-workflow.spec.ts", "workflow-materials.spec.ts", "workflow-curves.spec.ts", "workflow-interactions.spec.ts", "workflow-drag-recovery.spec.ts"],
  workers: 1,
  timeout: 180000,
  outputDir: "../../.creative-test-results/workflow",
  reporter: [
    ["list"],
    ["json", { outputFile: "../../.creative-test-results/workflow.json" }],
  ],
  webServer: {
    command:process.env.HELT_WORKFLOW_STATIC_ROOT?"node ../../scripts/serve-workflow-candidate.mjs":"node node_modules/next/dist/bin/next dev -p 3228 --hostname 127.0.0.1",
    url: "http://localhost:3228/login/",
    env: { NEXT_PUBLIC_SERVER_BASE_URL: "http://localhost:3315" },
    reuseExistingServer: false,
    timeout: 120000,
  },
  use: {
    screenshot:"only-on-failure",
    baseURL: "http://localhost:3228",
    browserName: "chromium",
    viewport: { width: 1440, height: 960 },
    actionTimeout: 15000,
  },
});
