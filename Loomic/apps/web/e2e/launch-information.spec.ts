import { expect, test } from "@playwright/test";

test("public launch information stays readable at mobile widths and preserves inquiry failures", async ({ page }, info) => {
  await page.route("**/api/**", route => route.fulfill({ status: 401, json: { error: { code: "unauthorized", message: "请先登录。" } } }));
  for (const route of ["contact-sales", "refund-policy", "privacy", "terms", "security", "docs"]) {
    await page.goto(`/${route}/`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    for (const width of [1440, 720, 320]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    }
    if (["contact-sales", "docs"].includes(route)) {
      await page.screenshot({ path: info.outputPath(`${route}-320.png`), fullPage: true });
    }
    await expect(page.locator("main")).not.toContainText("400-888-9999");
    await expect(page.locator("main")).not.toContainText("24 小时");
  }

  await page.goto("/contact-sales/");
  let fail = true;
  let submissions = 0;
  await page.route("**/api/contact-sales", async route => {
    submissions += 1;
    expect(route.request().postDataJSON()).toMatchObject({ email: "launch@example.test", source: "contact-page" });
    await route.fulfill(fail
      ? { status: 503, json: { error: { message: "咨询暂时不可用，请稍后重试。" } } }
      : { status: 201, json: { success: true, id: "launch-inquiry-001" } });
  });
  await page.getByRole("textbox", { name: "姓名", exact: true }).fill("发布验收");
  await page.getByRole("textbox", { name: "姓名", exact: true }).press("Tab");
  await expect(page.getByRole("textbox", { name: "联系邮箱", exact: true })).toBeFocused();
  await page.getByRole("textbox", { name: "联系邮箱", exact: true }).fill("launch@example.test");
  await page.getByRole("textbox", { name: "问题或需求", exact: true }).fill("请确认这是一份仅在本地测试的咨询记录。");
  await page.getByRole("button", { name: "提交咨询", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toBeFocused();
  await expect(page.getByRole("textbox", { name: "联系邮箱", exact: true })).toHaveValue("launch@example.test");
  fail = false;
  await page.getByRole("button", { name: "提交咨询", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "咨询已保存" })).toBeFocused();
  await expect(page.getByText("咨询编号：launch-inquiry-001", { exact: true })).toBeVisible();
  expect(submissions).toBe(2);
  await page.screenshot({ path: info.outputPath("inquiry-receipt-320.png"), fullPage: true });
});
