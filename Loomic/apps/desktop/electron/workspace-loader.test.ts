import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BrowserWindow } from "electron";
import { WorkspaceLoader } from "./workspace-loader.js";

function harness() {
  let url = "";
  const contents = Object.assign(new EventEmitter(), { getURL: () => url, stop: vi.fn() });
  const window = { webContents: contents, isDestroyed: () => false,
    loadURL: vi.fn(async (target: string) => { url = target; }),
    loadFile: vi.fn(async () => { url = "file:///C:/app/startup.html"; }), show: vi.fn() };
  const loader = new WorkspaceLoader(window as unknown as BrowserWindow, "C:/app/startup.html", "https://studio.test/desktop-app/", vi.fn());
  return { loader, window, contents };
}
afterEach(() => vi.useRealTimers());
describe("desktop workspace recovery", () => {
  it("shows a recovery page after a main frame network failure and retries the same route", async () => {
    const { loader, window, contents } = harness();
    window.loadURL.mockRejectedValueOnce(new Error("ERR_CONNECTION_REFUSED"));
    await loader.open("https://studio.test/video/?project=1");
    expect(window.loadFile).toHaveBeenCalledWith("C:/app/startup.html", { query: { state: "offline" } });
    expect(loader.navigate("helstera://desktop/retry")).toBe(true);
    await vi.waitFor(() => expect(window.loadURL).toHaveBeenLastCalledWith("https://studio.test/video/?project=1"));
    contents.emit("did-finish-load"); loader.dispose();
  });
  it("times out an unresponsive load and ignores failed subframes", async () => {
    vi.useFakeTimers();
    const { loader, window, contents } = harness();
    window.loadURL.mockImplementation(() => new Promise(() => {}));
    void loader.open("https://studio.test/desktop-app/");
    contents.emit("did-fail-load", {}, -105, "DNS", "https://other.test/", false);
    expect(window.loadFile).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(25_000);
    expect(window.loadFile).toHaveBeenCalledWith("C:/app/startup.html", { query: { state: "timeout" } });
    expect(window.webContents.stop).toHaveBeenCalled(); loader.dispose();
  });
  it("rejects recovery commands from a remote page and restores after renderer failure", async () => {
    const { loader, window, contents } = harness();
    await loader.open("https://studio.test/desktop-app/");
    contents.emit("did-finish-load");
    expect(loader.navigate("helstera://desktop/retry")).toBe(false);
    contents.emit("render-process-gone", {}, { reason: "crashed" });
    await vi.waitFor(() => expect(window.loadFile).toHaveBeenCalledWith("C:/app/startup.html", { query: { state: "crashed" } }));
    loader.dispose();
  });
  it("does not show an error for an old request aborted by a newer navigation", async () => {
    const { loader, window } = harness();
    let rejectOld!: (error: Error) => void;
    window.loadURL.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectOld = reject; }));
    const old = loader.open("https://studio.test/desktop-app/");
    await loader.open("https://studio.test/home/");
    rejectOld(new Error("ERR_ABORTED")); await old;
    expect(window.loadFile).not.toHaveBeenCalled(); loader.dispose();
  });
  it("can dispose after Electron has destroyed the window", () => {
    const { loader, window } = harness();
    window.isDestroyed = () => true;
    Object.defineProperty(window, "webContents", { get() { throw new Error("Object has been destroyed"); } });
    expect(() => loader.dispose()).not.toThrow();
  });
});
