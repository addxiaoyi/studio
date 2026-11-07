import { defineConfig } from "@playwright/test";
const evidence = process.env.HELT_TEST_REAL_MODEL === "1" ? "video-diff-undo-real" : "video-diff-undo";
export default defineConfig({
  testDir:"./e2e",testMatch:["video-diff-undo.spec.ts","video-conversation.spec.ts"],workers:1,timeout:480000,
  outputDir:`../../.creative-test-results/${evidence}`,
  reporter:[["list"],["json",{outputFile:`../../.creative-test-results/${evidence}.json`}]],
  webServer:{command:"node node_modules/next/dist/bin/next dev -p 3224 --hostname 127.0.0.1",url:"http://localhost:3224/login/",env:{NEXT_PUBLIC_SERVER_BASE_URL:"http://localhost:3311"},reuseExistingServer:false,timeout:120000},
  use:{baseURL:"http://localhost:3224",browserName:"chromium",viewport:{width:1440,height:960},actionTimeout:30000},
});
