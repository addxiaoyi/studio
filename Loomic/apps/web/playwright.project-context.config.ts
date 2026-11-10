import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir:"./e2e",testMatch:"project-context.spec.ts",workers:1,timeout:240_000,
  outputDir:"../../.creative-test-results/project-context",
  reporter:[["list"],["json",{outputFile:"../../.creative-test-results/project-context.json"}]],
  webServer:{
    command:"node node_modules/next/dist/bin/next dev -p 3238 --hostname 127.0.0.1",
    url:"http://localhost:3238/login/",env:{NEXT_PUBLIC_SERVER_BASE_URL:"http://localhost:3315"},reuseExistingServer:false,timeout:120_000,
  },
  use:{baseURL:"http://localhost:3238",browserName:"chromium",viewport:{width:1440,height:960},actionTimeout:20_000,screenshot:"only-on-failure"},
});
