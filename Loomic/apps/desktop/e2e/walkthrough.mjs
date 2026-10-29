#!/usr/bin/env node
/**
 * Real-Electron smoke test for the desktop shell, driven over the Chrome DevTools
 * Protocol. No test framework and no extra dependency: Node 22+ ships a global
 * WebSocket, so we can talk CDP to the packaged app directly.
 *
 * Why this exists: every desktop assertion in `test/*.test.tsx` runs in jsdom, which has
 * no layout engine and no real BrowserWindow. Bugs such as "the connectivity banner is
 * painted underneath the fixed titlebar" or "the focus outline computes to none" are
 * invisible there and only reproducible in a real renderer.
 *
 * Usage:
 *   node e2e/shell.e2e.mjs                                     # pre-auth shell chrome only
 *   E2E_EMAIL=… E2E_PASSWORD=… node e2e/shell.e2e.mjs          # sign in, then check the workspace
 *
 * Exit 0 = every check passed, 1 = a check failed, 2 = the harness could not run.
 * Credentials come from the environment and are never written anywhere.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const HERE = dirname(fileURLToPath(import.meta.url));
const APP_DIR = resolve(HERE, "..");
const EXE = join(APP_DIR, "release", "win-unpacked", "Helstera.exe");
const SHOTS = join(HERE, "screenshots");
const PORT = Number(process.env.E2E_PORT ?? 9333);
const ORIGIN = "https://studio.0st.top";

const results = [];
function check(name, passed, detail = "") {
  results.push({ name, passed, detail });
  console.log(`[${passed ? "PASS" : "FAIL"}] ${name}${detail ? ` — ${detail}` : ""}`);
}

async function waitForTargets(deadlineMs) {
  const end = Date.now() + deadlineMs;
  let seen = "no target";
  while (Date.now() < end) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      seen = targets.map((t) => `${t.type}:${t.url}`).join(" | ") || "none";
      // The shell owns several web contents; only the hosted workspace has an http URL.
      // Picking the first "page" grabs a transient about:blank and every DOM assertion
      // then fails for the wrong reason.
      const page = targets.find(
        (t) => t.type === "page" && t.webSocketDebuggerUrl && /^https?:/i.test(t.url ?? ""),
      );
      if (page) return page;
    } catch (error) {
      seen = error instanceof Error ? error.message : String(error);
    }
    await delay(500);
  }
  throw new Error(`devtools never exposed an http page target; saw: ${seen}`);
}

function connectCdp(url) {
  const socket = new WebSocket(url);
  const pending = new Map();
  let nextId = 1;

  socket.addEventListener("message", (event) => {
    const payload = JSON.parse(event.data);
    const entry = payload.id ? pending.get(payload.id) : undefined;
    if (!entry) return;
    pending.delete(payload.id);
    if (payload.error) entry.reject(new Error(payload.error.message));
    else entry.resolve(payload.result);
  });

  const ready = new Promise((done, fail) => {
    socket.addEventListener("open", () => done());
    socket.addEventListener("error", () => fail(new Error("websocket failed")));
  });

  function send(method, params = {}) {
    const id = nextId++;
    return new Promise((done, fail) => {
      pending.set(id, { resolve: done, reject: fail });
      socket.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id);
          fail(new Error(`${method} timed out`));
        }
      }, 30_000);
    });
  }

  return { ready, send, close: () => socket.close() };
}

/** Exchange credentials for the session cookie the hosted app itself sets. */
async function sessionCookie(email, password) {
  const res = await fetch(`${ORIGIN}/api/local-auth/password`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`password login failed: HTTP ${res.status}`);
  const raw = res.headers.getSetCookie?.() ?? [];
  const header = raw.find((c) => c.startsWith("helstera_session="));
  if (!header) throw new Error("login response carried no helstera_session cookie");
  const value = header.slice("helstera_session=".length).split(";")[0];
  return value;
}

async function main() {
  if (!existsSync(EXE)) {
    console.error(`missing packaged app: ${EXE}`);
    process.exit(2);
  }
  mkdirSync(SHOTS, { recursive: true });

  // A shell that exports ELECTRON_RUN_AS_NODE turns the packaged Electron binary into
  // plain Node: it rejects every Chromium switch with "bad option", prints the Node
  // version for --version and never opens a window.
  const childEnv = { ...process.env };
  delete childEnv.ELECTRON_RUN_AS_NODE;
  delete childEnv.NODE_OPTIONS;

  const child = spawn(
    EXE,
    [`--remote-debugging-port=${PORT}`, `--user-data-dir=${join(SHOTS, "profile")}`],
    { cwd: dirname(EXE), stdio: "ignore", env: childEnv },
  );

  let cdp;
  try {
    const target = await waitForTargets(60_000);
    cdp = connectCdp(target.webSocketDebuggerUrl);
    await cdp.ready;
    await cdp.send("Runtime.enable");
    await cdp.send("Page.enable");
    await cdp.send("Network.enable");

    const evaluate = async (expression) => {
      const out = await cdp.send("Runtime.evaluate", {
        expression,
        awaitPromise: true,
        returnByValue: true,
      });
      if (out.exceptionDetails) {
        throw new Error(out.exceptionDetails.exception?.description ?? "evaluate failed");
      }
      return out.result.value;
    };

    let url = await evaluate("location.href").catch(() => "");
    for (let i = 0; i < 90 && !/^https?:/i.test(url); i += 1) {
      await delay(1_000);
      url = await evaluate("location.href").catch(() => url);
    }
    console.log(`    url: ${url}`);
    check("app loads the hosted workspace", /studio\.0st\.top/.test(url), url);

    const email = process.env.E2E_EMAIL;
    const password = process.env.E2E_PASSWORD;
    if (email && password) {
      const cookie = await sessionCookie(email, password);
      console.log(`    obtained session cookie (${cookie.length} chars)`);
      await cdp.send("Network.setCookie", {
        name: "helstera_session",
        value: cookie,
        domain: "studio.0st.top",
        path: "/",
        secure: true,
        httpOnly: true,
        sameSite: "Lax",
      });
      await cdp.send("Page.reload", { ignoreCache: true });
      await delay(2_000);
      let authed = false;
      for (let i = 0; i < 60; i += 1) {
        authed = await evaluate(
          "!!document.querySelector('.helstera-desktop-titlebar') && !document.body.innerText.includes('在系统浏览器确认登录')",
        ).catch(() => false);
        if (authed) break;
        await delay(1_000);
      }
      check("session cookie reaches the signed-in shell", authed);
      url = await evaluate("location.href").catch(() => url);
      console.log(`    url after sign-in: ${url}`);
    }

    const summary = await evaluate(`(() => ({
      text: (document.body.innerText || "").replace(/\\s+/g, " ").slice(0, 220),
    }))()`).catch(() => null);
    console.log(`    page: ${summary?.text ?? "unreadable"}`);

    const titlebar = await evaluate("!!document.querySelector('.helstera-desktop-titlebar')");
    check("desktop titlebar is rendered", titlebar === true);

    // #75 / P2: measurements are route-specific. The agent home and the canvas workspace
    // lay out differently, so sweep the routes instead of asserting against whichever
    // page happens to be loaded.
    const routes = [
      "/desktop-app/",
      "/desktop-app/projects/",
      "/desktop-app/canvas/",
      "/desktop-app/settings/",
      "/desktop-app/mcp/",
    ];
    const perRoute = [];
    for (const route of routes) {
      await cdp.send("Page.navigate", { url: `${ORIGIN}${route}` });
      await delay(3_500);

      const items = await evaluate(`document.querySelectorAll(
        '.desktop-workspace-sidebar__item, .desktop-workspace-sidebar__settings').length`).catch(() => 0);
      // The shell keeps navigation in the titlebar. A sidebar toggle here would be a dead
      // control unless an embedded route also mounted a sidebar — that is the invariant.
      const hasToggle = await evaluate(
        `document.querySelector('.helstera-desktop-titlebar__sidebar-toggle') ? 1 : 0`,
      ).catch(() => 0);
      const titlebarLinks = await evaluate(
        `document.querySelectorAll('.helstera-desktop-titlebar a[href]').length`,
      ).catch(() => 0);

      // GEOMETRY_AUDIT — objective layout evidence at the native window size.
      {
        const audit = await evaluate(`(() => {
          const label = (el) => {
            const cls = (el.className && String(el.className).split(" ")[0]) || el.tagName.toLowerCase();
            const txt = (el.textContent || "").trim().slice(0, 28).replace(/\s+/g, " ");
            return cls + (txt ? ":" + txt : "");
          };
          const clipped = [];
          const offscreen = [];
          for (const el of document.querySelectorAll("body *")) {
            const style = getComputedStyle(el);
            if (style.display === "none" || style.visibility === "hidden") continue;
            const rect = el.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) continue;
            if (el.scrollWidth > el.clientWidth + 2 && style.overflowX !== "auto" && style.overflowX !== "scroll") {
              clipped.push(label(el) + " sw=" + el.scrollWidth + " cw=" + el.clientWidth);
            }
            if (rect.right > innerWidth + 2 || rect.left < -2) {
              offscreen.push(label(el) + " L=" + Math.round(rect.left) + " R=" + Math.round(rect.right) + " vw=" + innerWidth);
            }
          }
          const bar = document.querySelector(".helstera-desktop-titlebar");
          const barRect = bar ? bar.getBoundingClientRect() : null;
          const firstMain = document.querySelector("main");
          const mainRect = firstMain ? firstMain.getBoundingClientRect() : null;
          return {
            clipped: clipped.slice(0, 4),
            clippedCount: clipped.length,
            offscreen: offscreen.slice(0, 4),
            offscreenCount: offscreen.length,
            titlebarBottom: barRect ? Math.round(barRect.bottom) : null,
            mainTop: mainRect ? Math.round(mainRect.top) : null,
            innerWidth,
            innerHeight,
            docScrollH: document.documentElement.scrollHeight,
          };
        })()`).catch((error) => ({ error: String(error).slice(0, 80) }));
        console.log("    GEOMETRY " + route + " " + JSON.stringify(audit));
      }

      await cdp.send("Emulation.setDeviceMetricsOverride", {
        width: 720,
        height: 480,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await delay(900);
      const box = await evaluate(`(() => ({
        innerHeight,
        docScroll: document.documentElement.scrollHeight,
        bodyScroll: document.body.scrollHeight,
      }))()`).catch(() => ({ innerHeight: 480, docScroll: 0, bodyScroll: 0 }));
      await cdp.send("Emulation.clearDeviceMetricsOverride");
      await delay(400);

      const overflow = Math.max(box.docScroll, box.bodyScroll) - box.innerHeight;
      // Overflow alone is not a defect: a home page taller than a 480px viewport is fine as
      // long as the content can be scrolled to. What breaks users is a clipped page.
      const reach = await evaluate(`(() => {
        const html = getComputedStyle(document.documentElement);
        const body = getComputedStyle(document.body);
        const before = window.scrollY;
        window.scrollTo(0, 1e6);
        const after = window.scrollY;
        window.scrollTo(0, before);
        return { htmlOverflowY: html.overflowY, bodyOverflowY: body.overflowY, scrolledTo: after };
      })()`).catch(() => ({ htmlOverflowY: "?", bodyOverflowY: "?", scrolledTo: 0 }));
      const canScroll = reach.scrolledTo > 0;
      perRoute.push({
        route,
        items,
        hasToggle: hasToggle === 1,
        titlebarLinks,
        overflow,
        canScroll,
        reach,
      });
      console.log(
        `    ${route} → sidebarItems=${items} toggle=${hasToggle === 1}` +
          ` titlebarLinks=${titlebarLinks} overflow@720x480=${overflow}px` +
          ` scrollable=${canScroll} (html=${reach.htmlOverflowY}/body=${reach.bodyOverflowY})`,
      );
    }

    const deadControls = perRoute.filter((r) => r.hasToggle && r.items === 0);
    check(
      "no sidebar toggle is rendered without a sidebar to move",
      deadControls.length === 0,
      deadControls.length === 0 ? "none" : deadControls.map((r) => r.route).join(", "),
    );
    const minLinks = Math.min(...perRoute.map((r) => r.titlebarLinks));
    check("titlebar carries the shell navigation", minLinks >= 5, `min links per route = ${minLinks}`);

    const clipped = perRoute.filter((r) => r.overflow > 0 && !r.canScroll);
    check(
      "content stays reachable at the 720x480 minimum window",
      clipped.length === 0,
      clipped.length === 0
        ? perRoute.map((r) => `${r.route}=+${r.overflow}px scroll=${r.canScroll}`).join(", ")
        : clipped.map((r) => `${r.route} clipped +${r.overflow}px`).join(", "),
    );

    // Banner: while connected it is intentionally unmounted, so the actionable assertion
    // is on the parsed stylesheet. top:0 is what buried it under the 46px titlebar.
    const bannerRule = await evaluate(`(() => {
      for (const sheet of document.styleSheets) {
        let rules;
        try { rules = sheet.cssRules; } catch { continue; }
        for (const rule of rules) {
          if (rule.selectorText && rule.selectorText.includes('.desktop-connection-banner')) {
            return { top: rule.style.top, position: rule.style.position };
          }
        }
      }
      return null;
    })()`);
    check(
      "banner rule clears the fixed 46px titlebar",
      Boolean(bannerRule) && bannerRule.top !== "0px" && bannerRule.top !== "",
      bannerRule ? `position=${bannerRule.position} top=${bannerRule.top}` : "rule not found",
    );
    const bannerMounted = await evaluate("!!document.querySelector('.desktop-connection-banner')");
    console.log(`    banner mounted while connected: ${bannerMounted} (expected false)`);

    const bridge = await evaluate(
      "typeof (window.desktop ?? window.electronAPI ?? {}).windowFullscreen === 'function'",
    );
    check("preload exposes the fullscreen bridge", bridge === true);

    const focusRing = await evaluate(`(() => {
      const probe = document.querySelector(
        '.desktop-workspace-sidebar__item, .helstera-desktop-titlebar button');
      if (!probe) return null;
      probe.focus();
      const style = getComputedStyle(probe);
      return { outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth };
    })()`);
    check(
      "keyboard focus paints a visible outline",
      Boolean(focusRing) && focusRing.outlineStyle !== "none" && focusRing.outlineWidth !== "0px",
      focusRing ? `outline=${focusRing.outlineStyle}/${focusRing.outlineWidth}` : "no focusable element",
    );


    const shot = await cdp.send("Page.captureScreenshot", { format: "png" });
    const shotPath = join(SHOTS, "walk2-probe.png");
    writeFileSync(shotPath, Buffer.from(shot.data, "base64"));
    console.log(`    screenshot: ${shotPath}`);

    await cdp.send("Emulation.clearDeviceMetricsOverride");
  } finally {
    try {
      cdp?.close();
    } catch {
      // already closed
    }
    child.kill();
    await delay(1_500);
    if (!child.killed) child.kill("SIGKILL");
  }

  const failed = results.filter((r) => !r.passed);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  for (const item of failed) console.log(`  FAILED: ${item.name} — ${item.detail}`);
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(`harness error: ${error instanceof Error ? error.message : error}`);
  process.exit(2);
});
