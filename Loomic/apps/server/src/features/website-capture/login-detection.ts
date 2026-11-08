import type { Page } from "playwright";
import { sameWebsiteOrigin } from "@helstera/shared";

export async function discoverLoginPage(page:Page,originUrl:string,passwordMode=false){
  if(passwordMode){
    const mode=page.getByRole('button',{name:/使用密码登录|密码登录|账号密码登录|sign in with password|use password/i}).filter({visible:true});
    if(await mode.count()===1)await mode.click({timeout:5000,noWaitAfter:true});
  }
  if(await page.locator('input[type="password"]').filter({visible:true}).count())return;
  const links=await page.getByRole('link',{name:/^(登录|登錄|登入|登录账号|sign in|log in|login)$/i}).filter({visible:true}).all();
  if(links.length===1){
    const href=await links[0]!.getAttribute('href');
    if(href){const target=new URL(href,page.url()).href;if(sameWebsiteOrigin(target,originUrl))await page.goto(target,{waitUntil:'domcontentloaded',timeout:15000});}
    return;
  }
  const button=page.getByRole('button',{name:/^(登录|登錄|登入|sign in|log in|login)$/i}).filter({visible:true});
  if(await button.count()===1)await button.click({timeout:5000,noWaitAfter:true});
}
export async function loginSignature(page:Page){
  const state=await page.context().storageState();
  return JSON.stringify({cookies:state.cookies.filter(c=>/auth|token|session|sid|jwt/i.test(c.name)&&!/csrf|xsrf/i.test(c.name)).map(c=>[c.name,c.value]),storage:state.origins.map(o=>({origin:o.origin,entries:o.localStorage.filter(e=>/auth|token|session|jwt/i.test(e.name))}))});
}
export async function loginComplete(page:Page,input:{originUrl:string;initialUrl:string;signature:string;successText?:string;manual?:boolean}){
  if(!sameWebsiteOrigin(page.url(),input.originUrl))return false;
  if(await page.locator('input[type="password"],input[autocomplete="one-time-code"]').filter({visible:true}).count())return false;
  const challenges=await page.evaluate(`Array.from(document.querySelectorAll('iframe')).some(el=>/captcha|challenge/i.test(el.title+' '+el.src)&&el.getBoundingClientRect().height>80&&el.getBoundingClientRect().width>80)`);
  if(challenges)return false;
  if(input.successText)return await page.getByText(input.successText,{exact:false}).filter({visible:true}).count()>0;
  const changed=(await loginSignature(page))!==input.signature;
  const account=await page.getByRole('link',{name:/退出登录|注销登录|log out|sign out|my account|我的账户/i}).filter({visible:true}).count();
  if(input.manual)return changed||page.url()!==input.initialUrl||account>0;
  return changed&&(page.url()!==input.initialUrl||account>0);
}
