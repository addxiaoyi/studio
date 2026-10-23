import { describe, expect, it, vi } from "vitest";
import { DesktopLoginCallbackQueue, parseDesktopLoginCallback } from "./desktop-login.js";

const state = "s".repeat(43);
const token = "t".repeat(43);
const callback = `helstera://auth/callback?desktop_token=${token}&state=${state}`;

describe("desktop login callbacks", () => {
  it("accepts only a well-formed registered callback", () => {
    expect(parseDesktopLoginCallback(callback)).toEqual({ state, token });
    expect(parseDesktopLoginCallback("https://example.test/callback")).toBeNull();
    expect(parseDesktopLoginCallback(`helstera://auth/callback?desktop_token=short&state=${state}`)).toBeNull();
    expect(parseDesktopLoginCallback(`helstera://auth/callback@evil.test?desktop_token=${token}&state=${state}`)).toBeNull();
  });

  it("queues callbacks until a matching unexpired login attempt exists", () => {
    const queue = new DesktopLoginCallbackQueue();
    expect(queue.enqueue(callback, new Map([[state, 2_000]]), 1_000)).toEqual({ state, token });
    expect(queue.enqueue(callback, new Map([[state, 999]]), 1_000)).toBeNull();
  });

  it("makes callback delivery idempotent while navigation is pending", async () => {
    const queue = new DesktopLoginCallbackQueue();
    queue.enqueue(callback, new Map([[state, 2_000]]), 1_000);
    let finish!: () => void;
    const send = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));

    const first = queue.deliver(state, send);
    const duplicate = queue.deliver(state, send);
    expect(send).toHaveBeenCalledOnce();
    finish();
    await expect(Promise.all([first, duplicate])).resolves.toEqual([true, true]);
    expect(queue.pending()).toEqual([]);
  });

  it("does not replace a queued callback with a different token", () => {
    const queue = new DesktopLoginCallbackQueue();
    queue.enqueue(callback, new Map([[state, 2_000]]), 1_000);
    const otherToken = "x".repeat(43);

    expect(queue.enqueue(
      `helstera://auth/callback?desktop_token=${otherToken}&state=${state}`,
      new Map([[state, 2_000]]),
      1_000,
    )).toBeNull();
    expect(queue.pending()).toEqual([{ state, token }]);
  });

  it("keeps a failed callback queued so delivery can be retried", async () => {
    const queue = new DesktopLoginCallbackQueue();
    queue.enqueue(callback, new Map([[state, 2_000]]), 1_000);
    await expect(queue.deliver(state, async () => { throw new Error("load failed"); })).resolves.toBe(false);
    await expect(queue.deliver(state, async () => undefined)).resolves.toBe(true);
  });
});
