import type { Browser, BrowserContext, Locator, Page, Request } from "playwright";
import { sameWebsiteOrigin, type WebsiteLoginCredentials } from "@helstera/shared";

export type LoginNetworkScope = { origin: string; submitting: boolean; username: string; password: string; submissions?: number };
export function allowLoginRequest(request: Pick<Request, "url" | "method" | "postData">, scope: LoginNetworkScope) {
  const url = new URL(request.url());
  const sameOrigin = url.origin === scope.origin;
  const method = request.method().toUpperCase();
  const decodedUrl = (() => { try { return decodeURIComponent(url.href); } catch { return url.href; } })();
  if ([scope.username, scope.password].some(secret => secret && decodedUrl.includes(secret))) return false;
  if (method === "GET" || method === "HEAD") return !sameOrigin || !/logout|signout|delete|remove|purchase|checkout|payment|退出|删除|支付/i.test(url.pathname+url.search);
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

export async function signInWebsite(page: Page, credentials: WebsiteLoginCredentials, scope: LoginNetworkScope, assertActive: () => Promise<void>) {
  let phase="打开登录页";
  try {
    await assertActive();
    await page.goto(credentials.loginUrl, {waitUntil:"load",timeout:20_000});
    if (!sameWebsiteOrigin(page.url(),credentials.loginUrl)) throw new Error("登录页跳转到了其他站点，请提供实际登录站点或使用本地浏览器。");
    phase="识别登录控件";
    const password = await uniqueVisible(page.locator(credentials.passwordSelector ?? 'input[type="password"]'), "密码框");
    if(await page.getByText(credentials.successText,{exact:false}).filter({visible:true}).count())throw new Error("成功标记在登录前已可见，请选择仅登录后出现的文字。");
    const form = password.locator("xpath=ancestor::form[1]");
    const username = await uniqueVisible(page.locator(credentials.usernameSelector ?? 'input[autocomplete="username"],input[type="email"],input[name="username"],input[name="email"],input[name="account"]'), "账号框");
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
    await page.getByText(credentials.successText,{exact:false}).filter({visible:true}).first().waitFor({state:"visible",timeout:15_000});
    if(await password.isVisible())throw new Error("登录表单仍然可见，无法确认登录成功。");
    if (!sameWebsiteOrigin(page.url(),credentials.loginUrl)) throw new Error("登录后跳转到了未经确认的站点。");
    await assertActive();
  } catch {
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
