import { describe, expect, it } from "vitest";

import { buildBrowserPairingUrl } from "./browser-pairing.js";

const pairing = {
  pairingId: "753bdab7-991a-4fb3-9f72-9148703dba4b",
  code: "one-time-pairing-code",
  expiresAt: "2030-01-01T00:10:00.000Z",
  wssUrl: "wss://studio.0st.top/api/website-capture/assistant/ws",
  disclosure: "Browser pairing disclosure",
};

describe("buildBrowserPairingUrl", () => {
  it("puts the short-lived code only in the same-origin fragment", () => {
    const url = new URL(buildBrowserPairingUrl(pairing, "https://studio.0st.top/"));

    expect(url.origin).toBe("https://studio.0st.top");
    expect(url.pathname).toBe("/desktop-browser-pair.html");
    expect(url.search).toBe("");
    expect(new URLSearchParams(url.hash.slice(1)).get("code")).toBe(pairing.code);
  });

  it("allows loopback development when the web and API use different ports", () => {
    const url = buildBrowserPairingUrl({
      ...pairing,
      wssUrl: "ws://localhost:3001/api/website-capture/assistant/ws",
    }, "http://localhost:3103/");

    expect(new URL(url).origin).toBe("http://localhost:3103");
  });

  it("rejects foreign hosts, paths, credentials, and missing one-time codes", () => {
    expect(() => buildBrowserPairingUrl({
      ...pairing,
      wssUrl: "wss://attacker.example/api/website-capture/assistant/ws",
    }, "https://studio.0st.top/")).toThrow("浏览器配对地址与 Helstera 站点不匹配");

    expect(() => buildBrowserPairingUrl({ ...pairing, code: undefined }, "https://studio.0st.top/"))
      .toThrow("配对码缺失");
  });
});
