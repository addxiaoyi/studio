import { createServer, type Server } from "node:http";
import { once } from "node:events";
import { chromium, type Browser } from "playwright";
import { request } from "undici";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { abortResponseBody, PAGE_FACTS_SCRIPT } from "./isolated-browser.js";

describe("website capture runtime integration", () => {
  let browser: Browser;
  let server: Server;
  let origin: string;

  beforeAll(async () => {
    server = createServer((req, res) => {
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
});
