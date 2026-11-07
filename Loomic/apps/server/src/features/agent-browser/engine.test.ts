import { afterEach, describe, expect, it, vi } from "vitest";
import { browserEngine, launchAgentBrowser } from "./engine.js";
const launch=vi.hoisted(()=>vi.fn(async(launchOptions:unknown)=>({launchOptions})));
vi.mock("playwright",()=>({chromium:{launch,executablePath:()=>"test-chromium"}}));
afterEach(()=>{vi.unstubAllEnvs();vi.clearAllMocks();});
describe("isolated browser engine configuration", () => {
  it("does not silently substitute Chromium when Chromix was requested", () => {
    expect(() => browserEngine({ HELSTERA_BROWSER_ENGINE: "chromix" })).toThrow(
      /Chromix is not installed/,
    );
    expect(() => browserEngine({ HELSTERA_BROWSER_ENGINE: "unknown" })).toThrow(
      /Unsupported/,
    );
    expect(
      browserEngine({
        HELSTERA_BROWSER_ENGINE: "chromix",
        HELSTERA_CHROMIX_EXECUTABLE_PATH:
          process.platform === "win32"
            ? "C:/chromix/chrome.exe"
            : "/opt/chromix/chrome",
      }).name,
    ).toBe("chromix");
  });
  it("keeps service credentials out of the browser process environment",async()=>{
    vi.stubEnv("HELSTERA_BROWSER_ENGINE","chromium");vi.stubEnv("HELSTERA_PLAYWRIGHT_EXECUTABLE_PATH","");
    vi.stubEnv("OPENAI_API_KEY","must-not-reach-browser");vi.stubEnv("DATABASE_URL","must-not-reach-browser");
    await launchAgentBrowser();
    const options=launch.mock.calls[0]?.[0] as unknown as {env:Record<string,string>};
    expect(options.env).not.toHaveProperty("OPENAI_API_KEY");expect(options.env).not.toHaveProperty("DATABASE_URL");
    expect(Object.values(options.env)).not.toContain("must-not-reach-browser");
  });
});
