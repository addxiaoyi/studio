import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "prompt-library.spec.ts",
  workers: 1,
  timeout: 45_000,
  outputDir: "../../.creative-test-results/prompt-browser",
  reporter: [
    ["list"],
    [
      "json",
      { outputFile: "../../.creative-test-results/prompt-browser.json" },
    ],
  ],
  use: {
    browserName: "chromium",
    baseURL: "http://127.0.0.1:3441",
    viewport: { width: 1280, height: 900 },
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "python -m http.server 3441 --bind 127.0.0.1 --directory out",
    url: "http://127.0.0.1:3441/prompts/",
    reuseExistingServer: false,
  },
});
