import type { Page } from "playwright";
import { unsafeWebsiteLink,sameWebsiteOrigin,type WebsiteJourney } from "@helstera/shared";
import { validatePublicHttpUrl } from "./isolated-browser.js";

export async function resolveJourneyStep(page:Page,originUrl:string,step:WebsiteJourney['steps'][number]){
  let target=step.url;
  if(!target){
    const candidates=await page.evaluate(`Array.from(document.querySelectorAll('a[href]')).filter(a=>a.getClientRects().length).map(a=>({text:(a.getAttribute('aria-label')||a.textContent||'').replace(/\\s+/g,'').trim(),url:a.href}))`) as Array<{text:string;url:string}>;
    const wanted=step.linkText!.replace(/\s+/g,'').trim();
    const exact=candidates.filter(link=>link.text===wanted);
    const matches=exact.length?exact:candidates.filter(link=>link.text.includes(wanted));
    const links=[...new Set(matches.map(link=>link.url))];
    if(links.length!==1)throw new Error(`无法唯一找到“${step.linkText}”页面入口，请调整体验路线。`);
    target=links[0]!;
  }
  if(!sameWebsiteOrigin(target,originUrl)||unsafeWebsiteLink.test(target))throw new Error('页面入口超出已确认的浏览范围。');
  return (await validatePublicHttpUrl(target)).href;
}
