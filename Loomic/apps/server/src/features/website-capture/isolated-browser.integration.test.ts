import { createServer, type Server } from "node:http";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser } from "playwright";
import { request } from "undici";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { abortResponseBody, createCaptureByteBudget, fulfillBoundedCaptureResponse, PAGE_FACTS_SCRIPT } from "./isolated-browser.js";
import { closeCaptureContext } from "./capture-teardown.js";

describe("website capture runtime integration", () => {
  let browser: Browser;
  let server: Server;
  let origin: string;

  beforeAll(async () => {
    server = createServer((req, res) => {
      if (req.url?.startsWith("/budget/")) {
        res.writeHead(200, { "content-type": "text/plain" });
        res.end("123456");
        return;
      }
      if (req.url === "/stream") {
        res.writeHead(200, { "content-type": "text/plain" });
        res.write("partial");
        return;
      }
      res.writeHead(200, { "content-type": "text/html" });
      res.end('<title>Capture test</title><meta name="description" content="Public description"><nav><a href="/about">About</a></nav><h1>Heading</h1>');
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Test server did not bind to a TCP port");
    origin = `http://127.0.0.1:${address.port}`;
    browser = await chromium.launch({ headless: true, executablePath: chromium.executablePath() });
  });

  afterAll(async () => {
    await browser?.close();
    server?.closeAllConnections();
    if (server?.listening) await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });

  it("extracts page facts in a real Chromium context without compiler helpers", async () => {
    const page = await browser.newPage();
    try {
      await page.goto(origin);
      const facts = await page.evaluate(`(${PAGE_FACTS_SCRIPT})(16)`);
      expect(facts).toMatchObject({ title: "Capture test", description: "Public description", headings: ["Heading"], navigation: ["About"], links: [`${origin}/about`] });
      expect((await page.screenshot()).length).toBeGreaterThan(0);
    } finally {
      await page.close();
    }
  });

  it("handles an aborted undici response without an unhandled stream error", async () => {
    const response = await request(`${origin}/stream`);
    const closed = new Promise<void>((resolve) => response.body.once("close", resolve));
    abortResponseBody(response.body);
    await expect(closed).resolves.toBeUndefined();
  });

  it("closes pending resource streams before completing browser capture", async () => {
    const context = await browser.newContext();
    const requests = new AbortController();
    let resourceClosed = false;
    let resourceStarted!: () => void;
    const started = new Promise<void>(resolve => { resourceStarted = resolve; });
    await context.route("**/stream", async route => {
      const response = await request(`${origin}/stream`, { signal: requests.signal });
      response.body.once("close", () => { resourceClosed = true; });
      resourceStarted();
      try {
        await fulfillBoundedCaptureResponse(route, response.body, 200, { "content-type": "text/plain" }, createCaptureByteBudget(1024));
      } catch (error) {
        if (!requests.signal.aborted) throw error;
      }
    });
    const page = await context.newPage();
    try {
      await page.goto(origin);
      // The request belongs to the disposable page and rejects when that page closes.
      const pending = page.evaluate("fetch('/stream').catch(()=>null)").catch(() => undefined);
      await started;
      await closeCaptureContext(context, requests);
      await expect.poll(() => resourceClosed, { timeout: 1500 }).toBe(true);
      await pending;
    } finally {
      requests.abort();
      await context.close();
    }
  }, 15_000);

  it("aborts an over-budget concurrent response before it reaches Chromium", async () => {
    const context = await browser.newContext();
    const budget = createCaptureByteBudget(9);
    const outcomes: number[] = [];
    try {
      await context.route("**/budget/**", async (route) => {
        const response = await request(route.request().url());
        outcomes.push(await fulfillBoundedCaptureResponse(route, response.body, response.statusCode, { "content-type": "text/plain" }, budget, 10));
      });
      const page = await context.newPage();
      await page.goto(origin);
      const responses = await page.evaluate(`Promise.all(['/budget/a', '/budget/b'].map(url => fetch(url).then(r => r.text()).catch(() => 'blocked')))` ) as string[];
      expect(responses.sort()).toEqual(["123456", "blocked"]);
      expect(outcomes.sort()).toEqual([0, 6]);
      expect(budget.exhausted()).toBe(true);
    } finally {
      await context.close();
    }
  });

  it("produces a nonempty WebM recording from a real browser page", async () => {
    const directory = await mkdtemp(join(tmpdir(), "helstera-recording-test-"));
    const context = await browser.newContext({ recordVideo: { dir: directory } });
    try {
      const page = await context.newPage();
      await page.goto(origin);
      await page.waitForTimeout(300);
      const recording = page.video();
      expect(recording).not.toBeNull();
      await page.close();
      const bytes = await readFile(await recording!.path());
      expect(bytes.length).toBeGreaterThan(100);
      expect(bytes.subarray(0, 4).toString("hex")).toBe("1a45dfa3");
      const player = await browser.newPage();
      try {
        await player.goto(origin);
        const played = await player.evaluate(`(async (base64) => {
          const binary = atob(base64);
          const data = Uint8Array.from(binary, (character) => character.charCodeAt(0));
          const url = URL.createObjectURL(new Blob([data], { type: "video/webm" }));
          const video = document.createElement("video");
          video.muted = true;
          video.src = url;
          document.body.append(video);
          try {
            await video.play();
            await new Promise((resolve, reject) => {
              const timer = window.setTimeout(() => reject(new Error("Video playback did not advance")), 5000);
              video.addEventListener("timeupdate", () => {
                if (video.currentTime > 0) { window.clearTimeout(timer); resolve(); }
              });
              video.addEventListener("error", () => { window.clearTimeout(timer); reject(new Error("Video decoding failed")); });
            });
            return video.videoWidth > 0 && video.videoHeight > 0;
          } finally {
            video.pause();
            URL.revokeObjectURL(url);
          }
        })("${bytes.toString("base64")}")`);
        expect(played).toBe(true);
      } finally {
        await player.close();
      }
    } finally {
      await context.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
