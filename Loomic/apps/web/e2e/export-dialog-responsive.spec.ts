import {test,expect} from "@playwright/test";
import {createEditorBrowserFixture} from "../../server/src/features/video-editor/browser-fixture";

test("export settings retain labels, controls and keyboard focus at narrow widths and 200 percent",async({page,context},info)=>{
  const fixture=await createEditorBrowserFixture(process.env.DATABASE_URL!,"http://localhost:3219","{}");
  try {
    expect((await context.request.post("http://localhost:3311/api/local-auth/password",{data:{email:fixture.email,password:fixture.password}})).status()).toBe(200);
    await page.goto("http://localhost:3219/video/?/MyComp");
    await expect(page.getByLabel("导入本机素材",{exact:true})).toBeEnabled({timeout:90000});
    await page.getByRole("button",{name:"导出视频",exact:true}).click();
    const modal=page.locator("dialog[open]");
    await expect(modal).toContainText("容器");
    for(const [width,height] of [[1280,900],[760,450],[540,720],[320,640],[640,450]]) {
      await page.setViewportSize({width,height});
      await expect(modal.getByRole("button",{name:"常规",exact:true})).toBeVisible();
      await expect(modal.getByRole("button",{name:"容器",exact:true})).toBeVisible();
      await expect(modal.getByLabel("输出名称",{exact:true})).toBeVisible();
      expect(await modal.locator('.helstera-render-dialog').evaluate(el=>{
        const bounds=el.getBoundingClientRect();
        return bounds.left>=0&&bounds.top>=0&&bounds.right<=innerWidth+1&&bounds.bottom<=innerHeight+1&&el.scrollWidth<=el.clientWidth+1;
      })).toBe(true);
      const name=modal.getByLabel("输出名称",{exact:true});await name.fill(`out/窄屏导出-${width}.mp4`);
      await modal.getByRole("button",{name:"容器",exact:true}).click();
      const webm=modal.getByText("WebM",{exact:true});await expect(webm).toBeInViewport();await webm.click();
      await expect(name).toHaveValue(`out/窄屏导出-${width}.webm`);
      await modal.getByRole("button",{name:"容器",exact:true}).click();await modal.getByText("MP4",{exact:true}).click();
      await modal.getByRole("button",{name:"常规",exact:true}).focus();await page.keyboard.press("ArrowRight");
      await expect(modal.getByRole("button",{name:"输入属性",exact:true})).toHaveAttribute("aria-pressed","true");
      await page.keyboard.press("Home");await expect(modal.getByRole("button",{name:"常规",exact:true})).toHaveAttribute("aria-pressed","true");
      await page.keyboard.press("Tab");expect(await modal.evaluate(el=>el.contains(document.activeElement))).toBe(true);
      await page.screenshot({path:info.outputPath(`export-${width}x${height}.png`)});
    }
    await page.keyboard.press("Escape");await expect(modal).toHaveCount(0);
    expect((await fixture.db.query("select count(*)::int as n from background_jobs")).rows[0].n).toBe(0);
  } finally {await fixture.close();}
});
