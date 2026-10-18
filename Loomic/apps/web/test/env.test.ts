import { afterEach, describe, expect, it, vi } from "vitest";

import { getServerBaseUrl, loadWebEnv } from "../src/lib/env";

describe("@helstera/web env helpers", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("loads the browser-safe env values from process env", () => {
    vi.stubEnv("NEXT_PUBLIC_SERVER_BASE_URL", "http://localhost:4010");

    const env = loadWebEnv();

    expect(env).toEqual({
      serverBaseUrl: "http://localhost:4010",
    });
  });

  it("allows overrides", () => {
    vi.stubEnv("NEXT_PUBLIC_SERVER_BASE_URL", "http://localhost:4010");

    const env = loadWebEnv({ serverBaseUrl: "http://custom:3000" });

    expect(env.serverBaseUrl).toBe("http://custom:3000");
  });

  it("getServerBaseUrl returns serverBaseUrl", () => {
    vi.stubEnv("NEXT_PUBLIC_SERVER_BASE_URL", "http://localhost:4010");

    loadWebEnv(); // populate cache
    expect(getServerBaseUrl()).toBe("http://localhost:4010");
  });

  it("uses the site origin when a remote browser receives a loopback API URL", () => {
    vi.stubEnv("NEXT_PUBLIC_SERVER_BASE_URL", "http://localhost:3001");
    vi.stubGlobal("window", { location: { hostname: "studio.0st.top" } });
    expect(getServerBaseUrl()).toBe("");
  });

  it("uses same-origin API requests when a remote build has no API URL", () => {
    vi.stubEnv("NEXT_PUBLIC_SERVER_BASE_URL", "");
    vi.stubGlobal("window", { location: { hostname: "studio.0st.top" } });
    expect(getServerBaseUrl()).toBe("");
  });

  it("keeps localhost API routing for local development", () => {
    vi.stubEnv("NEXT_PUBLIC_SERVER_BASE_URL", "");
    vi.stubGlobal("window", { location: { hostname: "localhost" } });
    expect(getServerBaseUrl()).toBe("http://localhost:3001");
  });
});
