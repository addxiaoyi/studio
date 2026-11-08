import { expect,it } from "vitest";
import { launchAgentBrowser } from "../agent-browser/engine.js";
import { resolveJourneyStep } from "./journey-navigation.js";
it('uses real visible navigation in the specified order and refuses ambiguity',async()=>{
  const {browser}=await launchAgentBrowser();
  try{
    const page=await browser.newPage();await page.route('https://8.8.8.8/**',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:'<a href="/products">产品</a><a href="/pricing">定价</a><a href="/a">设置</a><a href="/b">设置</a>'}));
    await page.goto('https://8.8.8.8/');
    const order=[];
    for(const title of ['定价','产品']){const url=await resolveJourneyStep(page,'https://8.8.8.8/',{title,linkText:title,scroll:true});await page.goto(url);order.push(new URL(page.url()).pathname);}
    expect(order).toEqual(['/pricing','/products']);
    await expect(resolveJourneyStep(page,'https://8.8.8.8/',{title:'设置',linkText:'设置',scroll:true})).rejects.toThrow('唯一');
  }finally{await browser.close();}
});
