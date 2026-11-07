import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const imagePath = resolve(
  "../../vendor/fashion-source/assets/img/SPR-0001.webp",
);
async function setup(page: Page) {
  const image = await readFile(imagePath);
  let uploads = 0,
    quotes = 0,
    confirmations = 0,
    downloads = 0,
    status = "pending",
    job = false;
  await page.route("**/api/**", async (route) => {
    const req = route.request(),
      url = new URL(req.url());
    const headers = {
      "access-control-allow-origin": "http://localhost:3225",
      "access-control-allow-credentials": "true",
      "access-control-allow-headers":
        "authorization,content-type,idempotency-key",
      "access-control-allow-methods": "GET,POST,OPTIONS",
    };
    const json = (body: unknown, code = 200) =>
      route.fulfill({ json: body, status: code, headers });
    if (req.method() === "OPTIONS")
      return route.fulfill({ status: 204, headers });
    if (url.pathname === "/api/local-auth/session")
      return json({
        session: {
          access_token: "test",
          user: { id: id(1), email: "fashion@example.test" },
        },
      });
    if (url.pathname === "/api/image-models")
      return json({
        models: [
          {
            id: "a",
            displayName: "试穿模型甲",
            creditCost: 2.5,
            accessible: true,
            capabilities: { imageToImage: true },
            limits: { maxResolution: "2K" },
          },
          {
            id: "b",
            displayName: "试穿模型乙",
            creditCost: 3.5,
            accessible: true,
            capabilities: { imageToImage: true },
          },
          {
            id: "text",
            displayName: "仅文生图",
            creditCost: 1,
            accessible: true,
            capabilities: { imageToImage: false },
          },
        ],
        unavailableModels: [
          {
            id: "offline",
            displayName: "离线模型",
            availabilityReason: "服务暂不可用",
          },
        ],
      });
    if (url.pathname === "/api/uploads") {
      uploads++;
      return json({ asset: { id: id(10 + uploads) } });
    }
    if (url.pathname === "/api/jobs/image-generation") {
      quotes++;
      status = "pending";
      expect(req.postDataJSON()).toMatchObject({
        purpose: "try-on",
        model: "b",
        input_asset_ids: [expect.any(String), expect.any(String)],
      });
      return json(
        {
          error: { code: "generation_confirmation_required" },
          data: {
            approvalId: id(3),
            model: "b",
            estimatedCredits: 3.5,
            expiresAt: "2099-01-01T00:00:00Z",
          },
        },
        409,
      );
    }
    if (url.pathname.endsWith("/confirm")) {
      confirmations++;
      status = "approved";
      job = true;
      return json({ ok: true, data: { jobId: id(4) } });
    }
    if (url.pathname.endsWith("/cancel")) {
      status = "rejected";
      return json({ ok: true, data: { state: status } });
    }
    if (url.pathname.endsWith("/status"))
      return json({
        ok: true,
        data: { approvalStatus: status, ...(job ? { jobId: id(4) } : {}) },
      });
    if (url.pathname === `/api/jobs/${id(4)}`)
      return json({
        job: {
          id: id(4),
          status: "succeeded",
          progress: 100,
          result: { asset_id: id(5) },
        },
      });
    if (url.pathname === `/api/uploads/${id(5)}/file`) {
      downloads++;
      if (downloads === 1) return json({ error: "network" }, 503);
      return route.fulfill({ body: image, contentType: "image/webp", headers });
    }
    return json({}, 404);
  });
  return {
    counts: () => ({ uploads, quotes, confirmations, downloads }),
    status: () => status,
  };
}
test("try-on quotes bind the chosen model and recover results without another charge", async ({
  page,
}, info) => {
  const state = await setup(page);
  await page.goto("/fashion-gallery/");
  await page.getByRole("button", { name: "开始试穿", exact: true }).click();
  const model = page.getByRole("combobox", { name: "换装模型", exact: true });
  await model.click();
  await expect(page.getByRole("option", { name: /仅文生图/ })).toHaveAttribute(
    "aria-disabled",
    "true",
  );
  await page.getByRole("option", { name: /试穿模型乙/ }).click();
  await expect(page.getByLabel("模型与计费", { exact: true })).toContainText(
    "3.5 积分",
  );
  await page.locator("#fitFile").setInputFiles(imagePath);
  await page.locator("#fitGarmentList .g").first().click();
  await page
    .getByRole("button", { name: "查看本次试穿费用", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "确认本次试穿费用",
    exact: true,
  });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("试穿模型乙");
  await expect(dialog).toContainText("3.5 积分");
  expect(state.counts().confirmations).toBe(0);
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await expect(page.getByLabel("试穿任务状态", { exact: true })).toContainText(
    "没有启动生成或扣费",
  );
  expect(state.status()).toBe("rejected");
  await expect(page.locator("#aiServiceDialog")).not.toBeVisible();
  await page
    .getByRole("button", { name: "查看本次试穿费用", exact: true })
    .click();
  await dialog.getByRole("button", { name: "确认生成", exact: true }).click();
  await expect(page.locator("#aiServiceDialog")).toContainText("下载失败");
  expect(state.counts().confirmations).toBe(1);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "恢复试穿结果", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "恢复试穿结果", exact: true }).click();
  await expect(page.getByLabel("试穿结果回流", { exact: true })).toContainText(
    "私有素材库",
  );
  expect(state.counts()).toEqual({
    uploads: 4,
    quotes: 2,
    confirmations: 1,
    downloads: 2,
  });
  await page.screenshot({ path: info.outputPath("recovered-tryon.png") });
});
for (const theme of ["light", "dark"]) {
  test(`model list and settings remain usable at 320px in ${theme}`, async ({
    page,
  }, info) => {
    await setup(page);
    await page.addInitScript(
      (theme) => localStorage.setItem("theme", theme),
      theme,
    );
    await page.setViewportSize({ width: 320, height: 900 });
    await page.goto("/fashion-gallery/");
    await page.getByRole("button", { name: "开始试穿", exact: true }).click();
    const model = page.getByRole("combobox", { name: "换装模型", exact: true });
    await model.focus();
    await page.keyboard.press("ArrowDown");
    const list = page.getByRole("listbox", { name: "换装模型", exact: true });
    await expect(list).toBeVisible();
    expect(
      await list.evaluate((el) => {
        const r = el.getBoundingClientRect();
        return r.left >= 0 && r.right <= innerWidth;
      }),
    ).toBe(true);
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(model).toBeFocused();
    await model.click();
    await page.screenshot({ path: info.outputPath(`menu-${theme}-320.png`) });
    await page.keyboard.press("Escape");
    await expect(page.locator("#fitting")).toBeVisible();
    await page.getByRole("button", { name: "管理配置", exact: true }).click();
    const settings = page.locator("#aiSettings");
    await expect(settings).toBeVisible();
    const select = settings.getByRole("combobox").first();
    if (await select.isEnabled()) {
      await select.click();
      await expect(page.getByRole("listbox")).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(settings).toBeVisible();
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });
}

test("model menu stays within the CSS viewport equivalent to 200 percent browser zoom", async ({
  browser,
}, info) => {
  // Browser zoom halves the CSS viewport; CSS zoom does not emulate this layout.
  const context = await browser.newContext({ viewport: { width: 640, height: 480 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  try {
  await setup(page);
  await page.goto("http://localhost:3225/fashion-gallery/");
  await page.getByRole("button", { name: "开始试穿", exact: true }).click();
  const model = page.getByRole("combobox", { name: "换装模型", exact: true });
  await model.click();
  const list = page.getByRole("listbox", { name: "换装模型", exact: true });
  await expect(list).toBeVisible();
  await page.screenshot({ path: info.outputPath("menu-200-percent.png") });
  expect(
    await list.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight;
    }),
  ).toBe(true);
  await page.keyboard.press("Home");
  await page.keyboard.press("Enter");
  await expect(model).toBeFocused();
  } finally { await context.close(); }
});
