import {defineConfig} from "@playwright/test";
export default defineConfig({
  testDir:"./e2e",testMatch:"export-dialog-responsive.spec.ts",workers:1,timeout:180000,
  outputDir:"../../.creative-test-results/export-dialog",
  reporter:[["list"],["json",{outputFile:"../../.creative-test-results/export-dialog.json"}]],
  webServer:{command:process.env.HELT_WORKFLOW_STATIC_ROOT?"node ../../scripts/serve-workflow-candidate.mjs":"node node_modules/next/dist/bin/next dev -p 3219 --hostname 127.0.0.1",url:"http://localhost:3219/login/",env:{NEXT_PUBLIC_SERVER_BASE_URL:"http://localhost:3311",HELT_WORKFLOW_STATIC_PORT:"3219",HELT_WORKFLOW_API_PORT:"3311"},reuseExistingServer:false,timeout:120000},
  use:{baseURL:"http://localhost:3219",browserName:"chromium",viewport:{width:1280,height:900},screenshot:"only-on-failure"},
});
