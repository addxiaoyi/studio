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
    await expect(page.getByRole("link", { name: "下载 测试资产" })).toBeVisible();
    expect(previewAttempts).toBeGreaterThanOrEqual(2);
  });
});
