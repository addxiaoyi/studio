import { describe, expect, it } from "vitest";
import { isDesktopCallbackUrl } from "../src/lib/local-auth";

const state = "s".repeat(43);
const token = "t".repeat(43);

describe("desktop login callback URL validation", () => {
  it("accepts a state-bound loopback callback", () => {
    const url = `http://127.0.0.1:43821/callback?desktop_token=${token}&state=${state}`;
    expect(isDesktopCallbackUrl(url, state)).toBe(true);
  });

  it("continues to accept the registered protocol callback", () => {
    const url = `helstera://auth/callback?desktop_token=${token}&state=${state}`;
    expect(isDesktopCallbackUrl(url, state)).toBe(true);
  });

  it.each([
    `http://localhost:43821/callback?desktop_token=${token}&state=${state}`,
    `http://192.168.1.9:43821/callback?desktop_token=${token}&state=${state}`,
    `http://127.0.0.1/callback?desktop_token=${token}&state=${state}`,
    `http://127.0.0.1:43821/other?desktop_token=${token}&state=${state}`,
    `http://127.0.0.1:43821/callback?desktop_token=${token}&state=${"x".repeat(43)}`,
    `http://127.0.0.1:43821/callback?desktop_token=short&state=${state}`,
    `http://user@127.0.0.1:43821/callback?desktop_token=${token}&state=${state}`,
  ])("rejects an unsafe or mismatched callback: %s", (url) => {
    expect(isDesktopCallbackUrl(url, state)).toBe(false);
  });
});
