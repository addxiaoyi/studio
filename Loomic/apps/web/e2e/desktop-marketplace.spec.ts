import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { _electron as electron, expect, test, type Page } from "@playwright/test";

async function mockApi(page: Page) {
  let installed = false;
  let enabled = true;
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const catalog = ["skill", "mcp", "plugin"].map((kind) => ({
      id: kind, kind, name: `Test ${kind}`, slug: `test-${kind}`,
      description: `Test ${kind} description`, source_url: "https://example.com/",
      version: "1.0.0", license: null,
      manifest: kind === "mcp"
        ? { transport: "stdio", command: "npx", args: ["--yes", "@playwright/mcp@0.0.83"], requiredConfig: [] }
        : {},
    }));
    if (path === "/api/agent-marketplace/mcp/install" && route.request().method() === "POST") installed = true;
    const installs = installed ? [{
      item_id: "mcp", kind: "mcp", name: "Test mcp", slug: "test-mcp", target: "desktop",
      status: "installed", installed_version: "1.0.0", metadata: { enabled, localServerName: "Test mcp" },
    }] : [];
    const body = path === "/api/local-auth/session"
      ? { session: { access_token: "test-token", user: { id: "test-user", email: "test@example.com" } } }
      : { ok: true, data: path === "/api/agent-marketplace" ? catalog : path === "/api/agent-marketplace/installs" ? installs : [] };
    await route.fulfill({ json: body, headers: {
      "access-control-allow-origin": route.request().headers().origin ?? new URL(page.url()).origin,
      "access-control-allow-credentials": "true",
      "access-control-allow-headers": "authorization, content-type",
      "access-control-allow-methods": "GET, POST, OPTIONS",
    } });
  });
  return { setEnabled(value: boolean) { enabled = value; } };
}

test("desktop home opens the marketplace and MCP management", async ({ page }) => {
  await page.addInitScript(() => {
    const markDesktop = () => document.documentElement.setAttribute("data-helstera-desktop", "true");
    if (document.documentElement) markDesktop();
    else document.addEventListener("DOMContentLoaded", markDesktop, { once: true });
    const stop = () => () => {};
    Object.defineProperty(window, "electronAPI", { value: {
      onBrowserLoginState: stop,
      getBrowserLoginStatus: async () => ({ status: "idle" }),
      onNavigate: stop,
      onWindowState: stop,
      onNavigationState: stop,
      getWindowState: async () => ({ isMaximized: false }),
      getNavigationState: async () => ({ canGoBack: false, canGoForward: false }),
      getMcpServers: async () => [],
      syncDesktopExtensions: async () => [],
      onMarketplaceInstallRequested: stop,
      getPendingMarketplaceInstall: async () => null,
    } });
  });

  await mockApi(page);

  await page.goto("/desktop-app/");
  await expect(page.getByText("test@example.com")).toBeVisible();
  const links = page.locator(".desktop-extension-links");
  await expect(links.getByRole("link")).toHaveCount(2);
  await links.locator('a[href="/desktop-app/marketplace/"]').click();
  await expect(page).toHaveURL(/\/desktop-app\/marketplace\/?$/);
  await expect(page.locator(".agent-marketplace__toolbar")).toBeVisible();
  for (const kind of ["skill", "mcp", "plugin"]) {
    await expect(page.getByRole("heading", { name: `Test ${kind}` })).toBeVisible();
  }
  await page.goto("/desktop-app/");
  await page.locator('.desktop-extension-links a[href="/desktop-app/mcp/"]').click();
  await expect(page).toHaveURL(/\/desktop-app\/mcp\/?$/);
  await expect(page.locator(".desktop-feature__content--mcp")).toBeVisible();
});

test("marketplace installs Playwright MCP through the real desktop main process", async ({ baseURL }) => {
  test.skip(process.env.HELSTERA_ELECTRON_UI_SMOKE !== "1", "Requires a built desktop main process and Electron runtime");
  test.skip(process.platform !== "win32", "Windows candidate smoke test");
  test.setTimeout(120_000);
  const desktopDir = resolve(process.cwd(), "../desktop");
  const requireDesktop = createRequire(join(desktopDir, "package.json"));
  const executablePath = process.env.HELSTERA_UI_SMOKE_ELECTRON ?? requireDesktop("electron") as string;
  const profile = await mkdtemp(join(tmpdir(), "helstera-main-smoke-"));
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
  try {
    app = await electron.launch({
      executablePath,
      args: [join(desktopDir, "scripts", "main-process-smoke.cjs")],
      env: {
        ...process.env,
        HELSTERA_UI_SMOKE_PROFILE: profile,
        HELSTERA_DESKTOP_URL: baseURL ?? "http://localhost:3000",
        LOCALAPPDATA: profile,
        APPDATA: profile,
        USERPROFILE: profile,
      },
    });
    const page = await app.firstWindow();
    const market = await mockApi(page);
    await page.goto(new URL("/desktop-app/marketplace/", baseURL).toString());
    const card = page.locator(".agent-marketplace__card").filter({ has: page.getByRole("heading", { name: "Test mcp" }) });
    await card.locator("button.agent-marketplace__install").click();
    page.once("dialog", (dialog) => void dialog.accept());
    await page.locator('.agent-market-admin__overlay button[type="submit"]').click();
    await expect(page.locator(".agent-market-admin__overlay")).toBeHidden({ timeout: 90_000 });
    const servers = await page.evaluate(async () => window.electronAPI.getMcpServers());
    expect(servers.some((server) => server.name === "Test mcp" && server.connected
      && server.tools.some((tool) => tool.name === "browser_navigate"))).toBe(true);
    await expect.poll(async () => page.evaluate(async () => (await window.electronAPI.getDesktopExtensions())
      .find((extension) => extension.itemId === "mcp")?.status)).toBe("enabled");
    await page.goto(new URL("/desktop-app/mcp/", baseURL).toString());
    market.setEnabled(false);
    await page.evaluate(() => window.dispatchEvent(new Event("desktop:marketplace-install-changed")));
    await expect.poll(async () => page.evaluate(async () => (await window.electronAPI.getMcpServers())
      .find((server) => server.name === "Test mcp")?.connected)).toBe(false);
    market.setEnabled(true);
    await page.evaluate(() => window.dispatchEvent(new Event("desktop:marketplace-install-changed")));
    await expect.poll(async () => page.evaluate(async () => (await window.electronAPI.getMcpServers())
      .find((server) => server.name === "Test mcp")?.connected), { timeout: 30_000 }).toBe(true);
  } finally {
    await app?.close();
    await rm(profile, { recursive: true, force: true });
  }
});

test("desktop marketplace works with the real Electron preload", async ({ baseURL }) => {
  test.skip(process.env.HELSTERA_ELECTRON_UI_SMOKE !== "1", "Requires a built desktop preload and Electron runtime");
  test.skip(process.platform !== "win32", "Windows candidate smoke test");
  const desktopDir = resolve(process.cwd(), "../desktop");
  const requireDesktop = createRequire(join(desktopDir, "package.json"));
  const executablePath = process.env.HELSTERA_UI_SMOKE_ELECTRON ?? requireDesktop("electron") as string;
  const profile = await mkdtemp(join(tmpdir(), "helstera-ui-smoke-"));
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
  try {
    app = await electron.launch({
      executablePath,
      args: [join(desktopDir, "scripts", "marketplace-ui-smoke.cjs")],
      env: { ...process.env, HELSTERA_UI_SMOKE_PROFILE: profile },
    });
    const page = await app.firstWindow();
    await mockApi(page);
    await page.goto(new URL("/desktop-app/", baseURL).toString());
    await expect(page.getByText("test@example.com")).toBeVisible();
    await page.locator('.desktop-extension-links a[href="/desktop-app/marketplace/"]').click();
    for (const kind of ["skill", "mcp", "plugin"]) {
      await expect(page.getByRole("heading", { name: `Test ${kind}` })).toBeVisible();
    }
    await page.goto(new URL("/desktop-app/mcp/", baseURL).toString());
    await expect(page.locator(".desktop-feature__content--mcp")).toBeVisible();
  } finally {
    await app?.close();
    await rm(profile, { recursive: true, force: true });
  }
});
