import { type Page, type Route, expect, test } from "@playwright/test";

const mockToken = "ux100-test-token";

async function mockWorkspace(page: Page) {
  await page.route("**/api/local-auth/session", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        session: {
          access_token: mockToken,
          user: { id: "u", email: "u@x.com" },
        },
      }),
    }),
  );
  await page.route("**/api/viewer", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        profile: { id: "u", email: "u@x.com", displayName: "Test User" },
        workspace: {
          id: "w1",
          name: "Test",
          type: "personal",
          ownerUserId: "u",
        },
        membership: { workspaceId: "w1", userId: "u", role: "owner" },
        isSystemAdmin: false,
      }),
    }),
  );
  await page.route("**/api/credits", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ balance: 100, totalToppedUp: 100, totalSpent: 0 }),
    }),
  );
  await page.route("**/api/projects", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ projects: [] }),
    }),
  );
  await page.route("**/api/home/overview**", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        periodDays: 14,
        activeProjects: 0,
        monthlyGenerations: 0,
        teamMembers: 1,
        daily: [],
      }),
    }),
  );
}

function parseOklch(value: string) {
  const match = value.match(/oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)/);
  if (!match) throw new Error(`Expected an OKLCH token, received: ${value}`);
  const [, lightness, chroma, hue] = match;
  const l = Number(lightness);
  const c = Number(chroma);
  const h = (Number(hue) * Math.PI) / 180;
  const a = c * Math.cos(h);
  const b = c * Math.sin(h);
  const lms1 = l + 0.3963377774 * a + 0.2158037573 * b;
  const lms2 = l - 0.1055613458 * a - 0.0638541728 * b;
  const lms3 = l - 0.0894841775 * a - 1.291485548 * b;
  const lms1Cubed = lms1 ** 3;
  const lms2Cubed = lms2 ** 3;
  const lms3Cubed = lms3 ** 3;
  const red =
    4.0767416621 * lms1Cubed -
    3.3077115913 * lms2Cubed +
    0.2309699292 * lms3Cubed;
  const green =
    -1.2684380046 * lms1Cubed +
    2.6097574011 * lms2Cubed -
    0.3413193965 * lms3Cubed;
  const blue =
    -0.0041960863 * lms1Cubed -
    0.7034186147 * lms2Cubed +
    1.707614701 * lms3Cubed;
  const toSrgb = (channel: number) =>
    channel <= 0.0031308
      ? 12.92 * channel
      : 1.055 * channel ** (1 / 2.4) - 0.055;
  return [red, green, blue]
    .map(toSrgb)
    .map((channel) => Math.min(1, Math.max(0, channel)));
}

function contrastRatio(foreground: string, background: string) {
  const relativeLuminance = (color: string) => {
    const channels = parseOklch(color).map((channel) =>
      channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
    );
    const [red, green, blue] = channels;
    if (red === undefined || green === undefined || blue === undefined) {
      throw new Error("Expected RGB channels");
    }
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  };
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

test.describe("UX 100 visual safeguards", () => {
  test("workspace reflows at a 200% viewport proxy and preserves route context", async ({
    page,
  }) => {
    await mockWorkspace(page);
    await page.goto("/projects/archived");
    await expect(
      page.getByRole("navigation", { name: "页面路径" }),
    ).toBeVisible();
    await expect(page.getByText("回收站")).toHaveAttribute(
      "aria-current",
      "page",
    );

    // A 640 CSS-pixel viewport approximates a 200% zoomed 1280px desktop.
    await page.setViewportSize({ width: 640, height: 844 });
    const dimensions = await page.locator("body").evaluate((body) => ({
      scrollWidth: body.scrollWidth,
      clientWidth: body.clientWidth,
    }));
    expect(
      dimensions.scrollWidth,
      "no horizontal overflow at 200% viewport proxy",
    ).toBeLessThanOrEqual(dimensions.clientWidth);
  });

  test("workspace shell moves keyboard focus through skip, sidebar, and mobile More", async ({ page }) => {
    await mockWorkspace(page);
    await page.setViewportSize({ width: 1280, height: 844 });
    await page.goto("/home");
    const skipLink = page.getByRole("link", { name: "跳到主内容" });
    await expect(skipLink).toBeAttached();
    await expect(page.getByRole("textbox", { name: "创作提示词" })).toBeVisible();
    const modelButton = page.getByRole("button", { name: /选择图片或视频模型/ });
    await expect(modelButton).toHaveAttribute("aria-expanded", "false");
    await expect(modelButton).toHaveAccessibleName(/图片(自动|手动).*视频(自动|手动)/);
    await expect(page.getByText(/图片：.*视频：/)).toBeVisible();
    await page.evaluate(() => {
      document.body.tabIndex = -1;
      document.body.focus();
    });
    await page.keyboard.press("Tab");
    await expect(skipLink).toBeFocused();

    const sidebar = page.getByRole("complementary", { name: "工作区侧栏" });
    await sidebar.getByRole("link", { name: "工作台" }).focus();
    await expect(sidebar).toHaveClass(/w-56/);
    const libraryGroup = sidebar.getByRole("button", { name: "资源库" });
    await libraryGroup.click();
    await expect(libraryGroup).toHaveAttribute("aria-expanded", "true");
    await sidebar.getByRole("link", { name: "项目" }).click();
    await expect(page).toHaveURL(/\/projects\/?$/);
    await expect(page.locator("#main")).toBeFocused();
    await expect(sidebar.getByRole("button", { name: "资源库" })).toHaveAttribute("aria-expanded", "true");

    await page.setViewportSize({ width: 390, height: 844 });
    const more = page.getByRole("button", { name: "更多工作区导航" });
    await more.click();
    const moreRegion = page.getByRole("region", { name: "更多工作区导航" });
    await expect(moreRegion).toBeVisible();
    await expect(moreRegion.locator("a").first()).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(more).toBeFocused();
  });

  test("light and dark semantic text tokens meet AA contrast against their surfaces", async ({
    page,
  }) => {
    await page.goto("/login");
    const readContrast = () => {
      const styles = getComputedStyle(document.documentElement);
      return {
        foreground: styles.getPropertyValue("--foreground").trim(),
        muted: styles.getPropertyValue("--muted-foreground").trim(),
        background: styles.getPropertyValue("--background").trim(),
        card: styles.getPropertyValue("--card").trim(),
        primary: styles.getPropertyValue("--primary").trim(),
        primaryForeground: styles.getPropertyValue("--primary-foreground").trim(),
        destructive: styles.getPropertyValue("--destructive").trim(),
        success: styles.getPropertyValue("--success").trim(),
        warning: styles.getPropertyValue("--warning").trim(),
        warningForeground: styles.getPropertyValue("--warning-foreground").trim(),
      };
    };

    const light = await page.evaluate(readContrast);
    await page.evaluate(() => document.documentElement.classList.add("dark"));
    const dark = await page.evaluate(readContrast);

    for (const tokens of [light, dark]) {
      expect(
        contrastRatio(tokens.foreground, tokens.background),
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        contrastRatio(tokens.muted, tokens.background),
      ).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(tokens.primaryForeground, tokens.primary)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(tokens.destructive, tokens.background)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(tokens.success, tokens.background)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(tokens.warningForeground, tokens.warning)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(tokens.foreground, tokens.card)).toBeGreaterThanOrEqual(4.5);
    }
  });

  test("asset recovery copy and type filters expose their state", async ({ page }) => {
    await mockWorkspace(page);
    await page.route("**/api/assets/history**", (route: Route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: [], pagination: { page: 1, pageSize: 12, total: 0, hasMore: false } }),
      }),
    );
    await page.goto("/assets");
    await expect(page.getByRole("heading", { name: "我的资产" })).toBeVisible();
    await page.getByRole("button", { name: "查看恢复区" }).click();
    await expect(page.getByText("恢复区资产将在 7 天后清理")).toBeVisible();
    await expect(page.getByRole("button", { name: "全部" })).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "视频" }).click();
    await expect(page.getByRole("button", { name: "视频" })).toHaveAttribute("aria-pressed", "true");
  });

  test("asset previews keep a stable tile, expose page scope, and recover after retry", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockWorkspace(page);
    await page.route("**/api/assets/history**", (route: Route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: [{
            id: "asset-1",
            media_type: "image",
            title: "测试资产",
            description: null,
            prompt: "测试预览",
            mime_type: "image/png",
            created_at: "2026-10-19T00:00:00.000Z",
            asset_object_id: "upload-1",
            published: false,
            retention_state: "active",
          }],
          pagination: { page: 1, pageSize: 12, total: 3, hasMore: true },
        }),
      }),
    );
    let previewAttempts = 0;
    await page.route("**/api/uploads/upload-1/file**", (route: Route) => {
      previewAttempts += 1;
      if (previewAttempts === 1) {
        return route.fulfill({ status: 500, contentType: "application/json", body: "{}" });
      }
      return route.fulfill({
        status: 200,
        contentType: "image/png",
        body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"),
      });
    });

    await page.goto("/assets");
    await expect(page.getByText("文件加载失败（500）")).toBeVisible();
    const dimensions = await page.locator("body").evaluate((body) => ({ scrollWidth: body.scrollWidth, clientWidth: body.clientWidth }));
    expect(dimensions.scrollWidth, "asset page has no horizontal overflow at 390px").toBeLessThanOrEqual(dimensions.clientWidth);
    const assetCard = page.locator("article").filter({ hasText: "测试资产" });
    await expect(assetCard.locator("[aria-busy]")).toHaveClass(/aspect-square/);
    const batchBar = page.getByRole("region", { name: "资产批量操作" });
    await expect(batchBar).toContainText("当前页 1 项");
    await expect(batchBar).toContainText("共 3 项");
    await page.getByRole("button", { name: "选择 测试资产" }).click();
    await expect(batchBar).toContainText("已选 1 项");

    await page.getByRole("button", { name: "重试加载 测试资产" }).click();
    const download = page.getByRole("link", { name: "下载 测试资产" });
    await expect(download).toBeVisible();
    await download.focus();
    await expect(download).toBeFocused();
    const publish = page.getByRole("button", { name: "公开作品" });
    await publish.focus();
    await expect(publish).toBeFocused();
    expect(previewAttempts).toBeGreaterThanOrEqual(2);
  });

  test("asset editor failure retries the editor action instead of reloading the list", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockWorkspace(page);
    await page.route("**/api/assets/history**", (route: Route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: [{ id: "asset-editor", media_type: "image", title: "编辑测试资产", description: null, prompt: "编辑", mime_type: "image/png", created_at: "2026-10-19T00:00:00.000Z", asset_object_id: "upload-editor", published: false, retention_state: "active" }], pagination: { page: 1, pageSize: 12, total: 1, hasMore: false } }),
      }),
    );
    await page.route("**/api/uploads/upload-editor/file**", (route: Route) =>
      route.fulfill({ status: 200, contentType: "image/png", body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64") }),
    );
    let projectAttempts = 0;
    await page.route("**/api/projects", (route: Route) => {
      if (route.request().method() !== "POST") return route.fallback();
      projectAttempts += 1;
      if (projectAttempts === 1) return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: { message: "编辑器项目创建失败" } }) });
      return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ project: { id: "editor-project", name: "编辑测试资产", primaryCanvas: { id: "editor-canvas", name: "主画布", isPrimary: true } } }) });
    });

    await page.goto("/assets");
    await page.getByRole("button", { name: "在画布中编辑 编辑测试资产" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "编辑器项目创建失败" })).toBeVisible();
    await page.getByRole("button", { name: "重试打开画布" }).click();
    await expect(page).toHaveURL(/\/canvas\/?\?id=editor-canvas/);
    expect(projectAttempts).toBe(2);
  });

  test("asset loading reserves stable preview tiles", async ({ page }) => {
    await mockWorkspace(page);
    await page.route("**/api/assets/history**", async (route: Route) => {
      await new Promise((resolve) => setTimeout(resolve, 700));
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: [], pagination: { page: 1, pageSize: 12, total: 0, hasMore: false } }) });
    });
    await page.goto("/assets");
    const loading = page.getByRole("status", { name: "正在加载资产" });
    await expect(loading).toBeVisible();
    await expect(loading.locator(".aspect-square")).toHaveCount(8);
    await expect(loading).toBeHidden();
  });

  test("storyboard offers project recovery and exposes the current shot", async ({ page }) => {
    await mockWorkspace(page);
    await page.goto("/storyboard");
    await expect(page.getByRole("heading", { name: "创建分镜项目" })).toBeVisible();
    await expect(page.getByRole("button", { name: "创建并进入分镜工作台" })).toBeVisible();

    await page.route("**/api/projects/project-1/story-assets", (route: Route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ assets: [] }) }),
    );
    await page.route("**/api/projects/project-1/storyboards", (route: Route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ storyboards: [
          { id: "board-1", projectId: "project-1", sceneNo: 1, title: "雨夜开场", script: "进入街道", shotPrompt: "雨夜街道", imageAssetId: null, videoAssetId: null, status: "draft", metadata: {}, createdAt: "2026-10-19T00:00:00.000Z", updatedAt: "2026-10-19T00:00:00.000Z" },
          { id: "board-2", projectId: "project-1", sceneNo: 2, title: "产品特写", script: "展示产品", shotPrompt: "产品特写", imageAssetId: null, videoAssetId: null, status: "draft", metadata: {}, createdAt: "2026-10-19T00:00:00.000Z", updatedAt: "2026-10-19T00:00:00.000Z" },
        ] }),
      }),
    );
    await page.route("**/api/image-models", (route: Route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ models: [{ id: "image-model", displayName: "图片模型", description: "", provider: "test", accessible: true, providerPriceCny: 1, capabilities: { imageToImage: true }, limits: { maxResolution: "1K" } }], unavailableModels: [], defaultModel: "image-model" }) }));
    await page.route("**/api/video-models", (route: Route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ models: [{ id: "video-model", displayName: "视频模型", description: "", provider: "test", accessible: true, providerPriceCny: 1, capabilities: { textToVideo: true, imageToVideo: true, videoToVideo: false, audio: false }, limits: { maxDuration: 5, maxInputImages: 3, maxResolution: "720p" } }], unavailableModels: [] }) }));

    await page.goto("/storyboard?projectId=project-1");
    const firstShot = page.getByRole("button", { name: /第 1 个分镜：雨夜开场/ });
    const secondShot = page.getByRole("button", { name: /第 2 个分镜：产品特写/ });
    await expect(firstShot).toHaveAttribute("aria-current", "step");
    await expect(firstShot).toHaveAttribute("aria-pressed", "true");
    await secondShot.click();
    await expect(secondShot).toHaveAttribute("aria-current", "step");
    await expect(firstShot).not.toHaveAttribute("aria-current", "step");
    await expect(page.getByLabel("资产名称")).toBeVisible();
  });

  test("storyboard data failure retries in place", async ({ page }) => {
    await mockWorkspace(page);
    let assetAttempts = 0;
    await page.route("**/api/projects/project-retry/story-assets", (route) => {
      assetAttempts += 1;
      if (assetAttempts <= 2) {
        return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ message: "暂时不可用" }) });
      }
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ assets: [] }) });
    });
    await page.route("**/api/projects/project-retry/storyboards", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ storyboards: [] }) }),
    );
    await page.route("**/api/image-models", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ models: [], unavailableModels: [], defaultModel: "" }) }));
    await page.route("**/api/video-models", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ models: [], unavailableModels: [] }) }));

    await page.goto("/storyboard?projectId=project-retry");
    await expect(page.getByRole("alert")).toBeVisible();
    await page.getByRole("button", { name: "重试" }).click();
    await expect(page.getByRole("heading", { name: "分镜脚本" })).toBeVisible();
    expect(assetAttempts).toBeGreaterThanOrEqual(3);
  });

  test("storyboard model catalog failure retries in place", async ({ page }) => {
    await mockWorkspace(page);
    await page.route("**/api/projects/project-model-retry/story-assets", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ assets: [] }) }),
    );
    await page.route("**/api/projects/project-model-retry/storyboards", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ storyboards: [{ id: "board-model", projectId: "project-model-retry", sceneNo: 1, title: "模型恢复测试", script: "脚本", shotPrompt: "画面", imageAssetId: null, videoAssetId: null, status: "draft", metadata: {}, createdAt: "2026-10-19T00:00:00.000Z", updatedAt: "2026-10-19T00:00:00.000Z" }] }),
      }),
    );
    let imageModelAttempts = 0;
    await page.route("**/api/image-models", (route) => {
      imageModelAttempts += 1;
      if (imageModelAttempts <= 2) {
        return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ message: "模型目录暂时不可用" }) });
      }
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ models: [{ id: "image-model", displayName: "图片模型", description: "", provider: "test", accessible: true, providerPriceCny: 1, capabilities: { imageToImage: true }, limits: { maxResolution: "1K" } }], unavailableModels: [], defaultModel: "image-model" }) });
    });
    await page.route("**/api/video-models", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ models: [], unavailableModels: [] }) }));

    await page.goto("/storyboard?projectId=project-model-retry");
    await expect(page.getByRole("alert").filter({ hasText: "模型加载失败" })).toBeVisible();
    await page.getByRole("button", { name: "重试加载模型" }).click();
    await expect(page.getByRole("combobox", { name: "图片模型" })).toBeEnabled();
    expect(imageModelAttempts).toBeGreaterThanOrEqual(3);
  });

  test("storyboard asset edit failure preserves the draft and retries", async ({ page }) => {
    await mockWorkspace(page);
    await page.route("**/api/projects/project-asset-retry/story-assets", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ assets: [{ id: "asset-retry", projectId: "project-asset-retry", kind: "character", name: "旧名称", description: "旧描述", imageUrl: null, metadata: {}, createdAt: "2026-10-19T00:00:00.000Z", updatedAt: "2026-10-19T00:00:00.000Z" }] }),
      }),
    );
    await page.route("**/api/projects/project-asset-retry/storyboards", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ storyboards: [] }) }),
    );
    let updateAttempts = 0;
    await page.route("**/api/projects/project-asset-retry/story-assets/asset-retry", (route) => {
      updateAttempts += 1;
      if (updateAttempts === 1) {
        return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: { message: "资产保存暂时失败" } }) });
      }
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ asset: { id: "asset-retry", projectId: "project-asset-retry", kind: "character", name: "新名称", description: "新描述", imageUrl: null, metadata: {}, createdAt: "2026-10-19T00:00:00.000Z", updatedAt: "2026-10-19T00:00:00.000Z" } }) });
    });

    await page.goto("/storyboard?projectId=project-asset-retry");
    await page.getByRole("button", { name: "编辑旧名称" }).click();
    const assetNameInput = page.locator('input[aria-label="资产名称"]');
    await assetNameInput.fill("新名称");
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await expect(page.getByRole("alert").filter({ hasText: "资产保存暂时失败" })).toBeVisible();
    await expect(assetNameInput).toHaveValue("新名称");
    await page.getByRole("button", { name: "重试保存" }).click();
    await expect(page.getByText("新名称", { exact: true })).toBeVisible();
    expect(updateAttempts).toBe(2);
  });

  test("feed hotspot search exposes refresh state and can be cleared", async ({ page }) => {
    await mockWorkspace(page);
    await page.route("**/api/feed/trends**", async (route) => {
      const url = new URL(route.request().url());
      if (url.searchParams.get("q")) await new Promise((resolve) => setTimeout(resolve, 500));
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: { items: [{ id: "trend-1", platform: "系统热点", title: "测试热点", summary: "测试摘要", heat: 88, source_url: null }], total: 1, page: 1, pageSize: 10, totalPages: 1, sort: "heat", query: url.searchParams.get("q") ?? "" } }),
      });
    });
    await page.route("**/api/feed/packages", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: [] }) }));
    await page.route("**/api/feed/accounts", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: [] }) }));
    await page.route("**/api/feed/sources", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: [] }) }));
    await page.route("**/api/video-models", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ models: [], unavailableModels: [] }) }));

    await page.goto("/feed");
    const results = page.getByRole("region", { name: "实时热点结果" });
    await expect(results).toContainText("测试热点");
    const search = page.getByRole("textbox", { name: "搜索热点" });
    await search.fill("新品");
    await expect(results).toHaveAttribute("aria-busy", "true");
    await expect(page.getByRole("status").filter({ hasText: "正在刷新热点" })).toBeVisible();
    await expect(results).toHaveAttribute("aria-busy", "false");
    await page.getByRole("button", { name: "清除热点搜索" }).click();
    await expect(search).toHaveValue("");
  });
});
