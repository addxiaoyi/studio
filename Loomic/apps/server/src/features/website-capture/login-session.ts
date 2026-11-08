import type { Browser, BrowserContext, Locator, Page, Request } from "playwright";
import { sameWebsiteOrigin, type WebsiteLoginCredentials } from "@helstera/shared";
import { setTimeout as delay } from "node:timers/promises";
import { discoverLoginPage,loginComplete,loginSignature } from "./login-detection.js";

export type LoginNetworkScope = { origin: string; submitting: boolean; username: string; password: string; submissions?: number;human?:boolean };
export function redactLoginText(text: string, scope: Pick<LoginNetworkScope,"username"|"password">) {
  return [scope.username,scope.password].filter(Boolean).reduce((value,secret)=>value.split(secret).join("••••"),text);
}
export function isLoginVerificationUrl(url:URL){
  return /(^|\.)hcaptcha\.com$|(^|\.)recaptcha\.net$/.test(url.hostname)||url.hostname==='challenges.cloudflare.com'||(/(^|\.)google\.com$/.test(url.hostname)&&url.pathname.startsWith('/recaptcha/'));
}
export function allowLoginRequest(request: Pick<Request, "url" | "method" | "postData">, scope: LoginNetworkScope) {
  const url = new URL(request.url());
  const sameOrigin = url.origin === scope.origin;
  const method = request.method().toUpperCase();
  const urlValues=[...url.searchParams.values(),url.hash.slice(1)].filter(Boolean);
  if(urlValues.some(value=>(Boolean(scope.username)&&value===scope.username)||(Boolean(scope.password)&&value.includes(scope.password))))return false;
  if (method === "GET" || method === "HEAD") return !sameOrigin || !/logout|signout|delete|remove|purchase|checkout|payment|退出|删除|支付/i.test(url.pathname+url.search);
  const verification=scope.human&&isLoginVerificationUrl(url);
  const authEndpoint=sameOrigin&&/login|auth|captcha|verify|verification|challenge|session|otp|qrcode/i.test(url.pathname);
  if(scope.human&&['POST','OPTIONS'].includes(method)&&Buffer.byteLength(request.postData()??'')<=16384&&(verification||authEndpoint)){
    if(verification&&scope.password&&(request.postData()??'').includes(scope.password))return false;
    return true;
  }
  if (!sameOrigin || !scope.submitting || method !== "POST" || (scope.submissions??0)>0) return false;
  const body = request.postData() ?? "";
  if (Buffer.byteLength(body) > 16_384) return false;
  const containsPassword=body.includes(scope.password) || body.includes(encodeURIComponent(scope.password)) || body.includes(JSON.stringify(scope.password).slice(1,-1)) || [...new URLSearchParams(body).values()].some(value=>value===scope.password);
  if(containsPassword)scope.submissions=(scope.submissions??0)+1;
  return containsPassword;
}

async function uniqueVisible(locator: Locator, label: string) {
  const visible = locator.filter({visible:true});
  if (await visible.count() !== 1) throw new Error(`无法唯一识别${label}，请在高级设置指定控件，或使用本地已登录浏览器。`);
  if (!await visible.isEnabled()) throw new Error(`${label}暂不可用，请检查网站登录方式。`);
  return visible;
}

export async function signInWebsite(page: Page, credentials: WebsiteLoginCredentials, scope: LoginNetworkScope, assertActive: () => Promise<void>,handoff?: (check:()=>Promise<boolean>)=>Promise<void>) {
  let phase="打开登录页";
  let initialUrl=credentials.loginUrl,signature='';
  let takeoverUsed=false;
  const confirmManual=()=>loginComplete(page,{originUrl:credentials.loginUrl,initialUrl,signature,...(credentials.successText?{successText:credentials.successText}:{}),manual:true});
  async function takeOver(){
    if(!handoff)throw new Error('需要人工登录');
    takeoverUsed=true;
    scope.submitting=false;scope.human=true;
    try{await handoff(confirmManual);}finally{scope.human=false;}
  }
  try {
    await assertActive();
    await page.goto(credentials.loginUrl, {waitUntil:"load",timeout:20_000});
    if (!sameWebsiteOrigin(page.url(),credentials.loginUrl)) throw new Error("登录页跳转到了其他站点，请提供实际登录站点或使用本地浏览器。");
    await discoverLoginPage(page,credentials.loginUrl,credentials.method!=='interactive');
    initialUrl=page.url();signature=await loginSignature(page);
    if(credentials.method==='interactive'){await takeOver();return;}
    phase="识别登录控件";
    const password = await uniqueVisible(page.locator(credentials.passwordSelector ?? 'input[type="password"]'), "密码框");
    if(credentials.successText&&await page.getByText(credentials.successText,{exact:false}).filter({visible:true}).count())throw new Error("成功标记在登录前已可见，请选择仅登录后出现的文字。");
    const form = password.locator("xpath=ancestor::form[1]");
    const preferred=page.locator(credentials.usernameSelector ?? 'input[autocomplete="username"],input[type="email"],input[name="username"],input[name="email"],input[name="account"],input[name="login"]');
    const username = await uniqueVisible(await preferred.filter({visible:true}).count()?preferred:(await form.count()===1?form:page).locator('input:not([type]),input[type="text"],input[type="tel"]'), "账号框");
    const submit = await uniqueVisible(credentials.submitSelector
      ? page.locator(credentials.submitSelector)
      : (await form.count() === 1 ? form : page).getByRole("button", {name:/^(登录|登錄|登入|sign in|log in|login|登录账号)$/i}), "登录按钮");
    if (await form.count() === 1) {
      const action = await form.getAttribute("action");
      if (action && !sameWebsiteOrigin(new URL(action,page.url()).href,credentials.loginUrl)) throw new Error("登录表单将账号发送到另一个站点，任务已停止。");
    }
    await assertActive();
    phase="填写账号";
    await username.fill(credentials.username);
    await password.fill(credentials.password);
    if (!sameWebsiteOrigin(page.url(),credentials.loginUrl)) throw new Error("登录站点发生变化，任务已停止。");
    scope.submitting = true;
    phase="提交登录";
    await submit.click({timeout:8000,noWaitAfter:true});
    phase="确认登录结果";
    const deadline=Date.now()+10000;
    while(Date.now()<deadline){
      await assertActive();
      if(await loginComplete(page,{originUrl:credentials.loginUrl,initialUrl,signature,...(credentials.successText?{successText:credentials.successText}:{})}))return;
      await delay(250);
    }
    await takeOver();
  } catch {
    if(handoff&&!takeoverUsed&&!page.isClosed()&&sameWebsiteOrigin(page.url(),credentials.loginUrl)){await assertActive();await takeOver();return;}
    // Playwright call logs can include fill values and selectors. Never persist those errors.
    throw new Error(`登录未完成（${phase}）：请核对账号密码、登录后可见文字或高级控件设置；验证码、扫码、二次验证请使用本地已登录浏览器。凭据已销毁，需重新填写。`);
  } finally {
    scope.submitting = false;
  }
}

export async function addCredentialMask(context: BrowserContext, secrets: string[]) {
  await context.addInitScript(`(() => {
    const secrets=${JSON.stringify(secrets.filter(Boolean))};
    const hide=text=>secrets.reduce((value,secret)=>value.split(secret).join('••••'),text);
    function mask(){
      if(!document.documentElement)return;
      const walker=document.createTreeWalker(document.documentElement,NodeFilter.SHOW_TEXT);let node;
      while(node=walker.nextNode()){
        if(node.parentElement?.closest('script,style'))continue;
        const text=hide(node.textContent||'');if(text!==node.textContent)node.textContent=text;
      }
      for(const el of document.querySelectorAll('input,textarea,select,[contenteditable="true"]')){
        el.style.setProperty('color','transparent','important');el.style.setProperty('-webkit-text-fill-color','transparent','important');el.style.setProperty('text-shadow','none','important');el.style.setProperty('caret-color','transparent','important');
      }
      const title=hide(document.title);if(title!==document.title)document.title=title;
    }
    // Observe parsing too, so recording cannot capture a pre-DOMContentLoaded credential flash.
    new MutationObserver(mask).observe(document,{childList:true,subtree:true,characterData:true});mask();
  })()`);
}

export async function newAuthenticatedContext(browser: Browser, loginContext: BrowserContext, recording: {dir:string;size:{width:number;height:number}} | undefined, secrets: string[]) {
  const storageState = await loginContext.storageState();
  const loginPage=loginContext.pages()[0];
  const sessionState=loginPage?await loginPage.evaluate("({origin:location.origin,entries:Object.entries(sessionStorage)})") as {origin:string;entries:[string,string][]}:null;
  await loginContext.close();
  const context = await browser.newContext({storageState,viewport:{width:1280,height:720},serviceWorkers:"block",acceptDownloads:false,reducedMotion:"reduce",...(recording?{recordVideo:recording}:{})});
  if(sessionState)await context.addInitScript(`(()=>{const state=${JSON.stringify(sessionState)};if(location.origin===state.origin)for(const [key,value] of state.entries)sessionStorage.setItem(key,value);})()`);
  await addCredentialMask(context,secrets);
  return context;
}
