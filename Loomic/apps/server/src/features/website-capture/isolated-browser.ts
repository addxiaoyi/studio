import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Agent, request as httpRequest } from "undici";
import { chromium, type Route, type WebSocketRoute } from "playwright";
import { z } from "zod";
import { launchAgentBrowser } from "../agent-browser/engine.js";
import { browserViewStore } from "../agent-browser/store.js";
import { observeAgentBrowser } from "../agent-browser/observer.js";
import { websitePresentationSchema, type WebsitePresentation } from "@helstera/shared";
import { capturePresentationScene, type PresentationScene } from "./presentation-snapshot.js";
import { recordWebsitePresentation } from "./presentation.js";
import { consumeWebsiteLogin, discardWebsiteLogin } from "./login-vault.js";
import { allowLoginRequest, signInWebsite, newAuthenticatedContext, redactLoginText,isLoginVerificationUrl,isAllowedLoginNavigation, type LoginNetworkScope } from "./login-session.js";
import { sameWebsiteOrigin, type WebsiteLoginRef } from "@helstera/shared";
import { validateWebsiteJourney,type WebsiteJourney } from "@helstera/shared";
import { waitForWebsiteLogin } from "./login-handoff.js";
import { rememberWebsiteSession,restoreWebsiteSession,assertWebsiteSessionActive } from "./saved-login.js";
import { resolveJourneyStep } from "./journey-navigation.js";
import { mosaicScreenshot,installPrivacyMosaic } from "../agent-browser/privacy-mosaic.js";
import { recordPageSegment } from "./page-recording.js";
import { joinCaptureSegments } from "./video-encoder.js";
import { closeCaptureContext } from "./capture-teardown.js";
import { assertConnectorEnabled } from "../agent-goals/connector-gate.js";
import type { Pool, PoolClient } from "pg";
import type { StorageProvider } from "../../storage/storage-provider.js";
import type { WebsiteCaptureClaim, WebsiteCaptureEvidence, WebsiteCapturePage, WebsiteCaptureResult } from "@helstera/shared";

const PAGE_TIMEOUT_MS = 15_000;
const PAGE_SETTLE_MS = 650;
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_BYTES = 32 * 1024 * 1024;
const MAX_VIDEO_BYTES = 40 * 1024 * 1024;
const MAX_HEADINGS = 16;

const pageFactsSchema = z.object({
  url: z.string().url(),
  title: z.string(),
  description: z.string(),
  headings: z.array(z.string()),
  navigation: z.array(z.string()),
  links: z.array(z.string().url()),
});

export type CaptureTask = {
  id: string;
  workspace_id: string;
  created_by: string;
  start_url: string;
  page_limit: number;
  record_video: boolean;
  follow_external?: boolean;
  presentation?: WebsitePresentation | null;
  login?: WebsiteLoginRef | null;
  journey?: WebsiteJourney | null;
};

type CaptureProgress = (percent: number, stage: string, detail?: string) => Promise<void>;

type PageFacts = Omit<WebsiteCapturePage, "assetId" | "screenshotUrl"> & {
  screenshot: Buffer;
  width: number;
  height: number;
};

export const PAGE_FACTS_SCRIPT = String.raw`(maxHeadings) => {
  const document = globalThis.document;
  const location = globalThis.location;
  const clean = (value) => (value ?? "").replace(/\s+/g, " ").trim().slice(0, 500);
  const description = clean(
    document.querySelector('meta[name="description"]')?.getAttribute("content")
      ?? document.querySelector('meta[property="og:description"]')?.getAttribute("content"),
  );
  const headings = Array.from(document.querySelectorAll("h1, h2, h3"))
    .map((heading) => clean(heading.textContent))
    .filter(Boolean)
    .slice(0, maxHeadings);
  const navigation = Array.from(document.querySelectorAll("header a, nav a"))
    .map((anchor) => clean(anchor.textContent))
    .filter(Boolean)
    .slice(0, 24);
  const links = Array.from(document.querySelectorAll("a[href]"))
    .map((anchor) => anchor.href)
    .filter((href) => href.startsWith("https://") || href.startsWith("http://"));
  return {
    url: location.href,
    title: clean(document.title) || location.hostname,
    description,
    headings,
    navigation: [...new Set(navigation)],
    links: [...new Set(links)].slice(0, 80),
  };
}`;

export class WebsiteCaptureError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "WebsiteCaptureError";
    this.code = code;
  }
}

export async function captureIsolatedWebsite(options: {
  db: Pool;
  storage: StorageProvider;
  storageRoot: string;
  webOrigin: string;
  task: CaptureTask;
  onProgress: CaptureProgress;
  signal?: AbortSignal;
}): Promise<WebsiteCaptureResult> {
  const startUrl = await validatePublicHttpUrl(options.task.start_url);
  const tempDir = await mkdtemp(join(tmpdir(), `helstera-capture-${options.task.id}-`));
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  let videoPath: string | undefined;
  let view: Awaited<ReturnType<typeof observeAgentBrowser>> | undefined;
  let capturedSuccessfully = false;
  async function closeView(state:"completed"|"failed",detail:string){await view?.close(state,detail);view=undefined;}
  const presentation=options.task.presentation?websitePresentationSchema.parse(options.task.presentation):null;
  if(presentation&&!options.task.record_video)throw new Error("网站演示需要先确认录制。");
  const scenes:PresentationScene[]=[];
  const networkRequests = new AbortController();
  const segments:string[]=[],segmentDurations:number[]=[];
  let savedSessionId:string|undefined;
  const sessionOwner={workspaceId:options.task.workspace_id,userId:options.task.created_by};
  const assertCaptureActive=async()=>{options.signal?.throwIfAborted();await assertTaskIsRunning(options.db,options.task.id);if(savedSessionId)await assertWebsiteSessionActive(options.db,savedSessionId,sessionOwner);};
  if(options.task.journey)validateWebsiteJourney(options.task.start_url,options.task.journey);
  const abort = () => { networkRequests.abort();void browser?.close().catch(error => console.error("[capture] cancellation close failed", error)); };
  options.signal?.throwIfAborted();
  options.signal?.addEventListener("abort", abort, { once: true });

  try {
    await options.onProgress(5, "browser_starting", "Starting a temporary browser");
    const launched = await launchAgentBrowser();
    browser = launched.browser;
    options.signal?.throwIfAborted();
    let context = await browser.newContext({
      acceptDownloads: false,
      ignoreHTTPSErrors: false,
      permissions: [],
      serviceWorkers: "block",
      ...(presentation ? { reducedMotion: "reduce" as const } : {}),
      viewport: { width: 1280, height: 720 },
    });
    await installPrivacyMosaic(context,true);
    const budget = createCaptureByteBudget(MAX_TOTAL_BYTES);
    let requestCount = 0;
    let loginScope: LoginNetworkScope | undefined;
    const installNetwork = async () => {
      await context.routeWebSocket("**/*", blockIsolatedWebSocket);
      await context.route("**/*", async (route) => {
      try{
        if(options.task.login)await assertConnectorEnabled(options.db,options.task.workspace_id,options.task.created_by,"isolated-browser");
        await assertCaptureActive();
      }catch{await route.abort('blockedbyclient');return;}
      requestCount += 1;
      if (requestCount > (loginScope?.human?1000:180) || budget.exhausted()) {
        await route.abort("blockedbyclient");
        return;
      }
      if(loginScope&&route.request().isNavigationRequest()&&!isAllowedLoginNavigation(route.request().url(),options.task.start_url,Boolean(route.request().frame().parentFrame()),loginScope.human?loginScope.allowedOrigins:[])){
        const target=await validatePublicHttpUrl(route.request().url()).catch(()=>null);
        if(target?.protocol==='https:'&&!route.request().frame().parentFrame()&&(loginScope.proposedOrigins?.size??0)<3){
          loginScope.proposedOrigins?.set(target.origin,target.href);
          await route.fulfill({status:403,contentType:'text/html; charset=utf-8',body:'<!doctype html><title>等待登录来源确认</title><main style="font:20px system-ui;padding:48px"><h1>此登录来源需要你确认</h1><p>请在接管区域选择“允许此登录来源”，确认后继续登录。尚未向该站点发送账号信息。</p></main>'});return;
        }
        await route.abort("blockedbyclient");return;
      }
      await fulfillPublicReadOnlyRequest(route, budget,loginScope,networkRequests.signal);
      });
    };
    await installNetwork();
    if(options.task.login){
      if(!options.task.record_video||options.task.follow_external||!sameWebsiteOrigin(startUrl.href,options.task.login.loginUrl))throw new Error("登录任务范围与审批不符。");
      await options.onProgress(6,"signing_in","正在登录指定站点，登录画面不会录制。");
      const credentials=await consumeWebsiteLogin(options.db,options.task.id,options.task.workspace_id,options.task.created_by,options.task.login);
      loginScope={origin:startUrl.origin,submitting:false,username:credentials.username,password:credentials.password,allowedOrigins:credentials.allowedLoginOrigins??[],proposedOrigins:new Map(),human:credentials.method==='interactive'};
      const loginPage=await context.newPage();
      const assertLogin=async()=>{options.signal?.throwIfAborted();await assertConnectorEnabled(options.db,options.task.workspace_id,options.task.created_by,'isolated-browser');await assertTaskIsRunning(options.db,options.task.id);};
      if(credentials.method==='saved'&&credentials.savedSessionId){
        savedSessionId=credentials.savedSessionId;
        await options.db.query('update website_capture_tasks set browser_session_id=$2 where id=$1',[options.task.id,savedSessionId]);
        await restoreWebsiteSession(options.db,{workspaceId:options.task.workspace_id,userId:options.task.created_by},startUrl.origin,credentials.savedSessionId,context);
        await loginPage.goto(credentials.loginUrl,{waitUntil:'domcontentloaded',timeout:15000});
        if(!sameWebsiteOrigin(loginPage.url(),credentials.loginUrl)||/login|signin|sign-in|verify|challenge/i.test(new URL(loginPage.url()).pathname)||await loginPage.locator('input[type="password"]').filter({visible:true}).count())throw new Error('记住的会话已失效，请重新登录。');
      }else await signInWebsite(loginPage,credentials,loginScope,assertLogin,check=>waitForWebsiteLogin({page:loginPage,db:options.db,storageRoot:options.storageRoot,taskId:options.task.id,workspaceId:options.task.workspace_id,userId:options.task.created_by,engine:launched.engine,assertActive:assertLogin,check,loginScope:loginScope!,heartbeat:()=>options.onProgress(8,'waiting_login','等待你完成登录验证，原任务将继续。')}));
      if(credentials.rememberSession){savedSessionId=await rememberWebsiteSession(options.db,sessionOwner,startUrl.origin,context,loginPage,loginScope.allowedOrigins);await options.db.query('update website_capture_tasks set browser_session_id=$2 where id=$1',[options.task.id,savedSessionId]);}
      context=await newAuthenticatedContext(browser,context,undefined,[credentials.username,credentials.password]);
      requestCount=0;
      await installNetwork();
      await options.onProgress(9,"signed_in","登录成功，开始记录站内体验。账号密码已从服务端销毁。");
    }
    context.on("page", (page) => {
      if (page !== context.pages()[0]) void page.close();
    });
    const page = await context.newPage();
    page.setDefaultNavigationTimeout(PAGE_TIMEOUT_MS);
    page.setDefaultTimeout(PAGE_TIMEOUT_MS);
    if (process.env.HELSTERA_BROWSER_VIEW_ENABLED === "1") {
      view = await observeAgentBrowser({ page, engine: launched.engine,
        store: browserViewStore(options.db,options.storageRoot), taskId: options.task.id,
        workspaceId: options.task.workspace_id, userId: options.task.created_by,
        assertActive: () => assertTaskIsRunning(options.db,options.task.id),
        externalFrames:options.task.record_video,
        ...(options.signal ? { signal: options.signal } : {}),
        ...(options.task.login ? { sourceUrl:startUrl.origin+startUrl.pathname } : {}),
      });
    }

    const journey=options.task.journey;
    const pending = journey?journey.steps.map(step=>step.url??''):[startUrl.toString()];
    let journeyIndex=0;
    const visited = new Set<string>();
    const captured: PageFacts[] = [];
    while (pending.length > 0 && captured.length < options.task.page_limit) {
      await assertTaskIsRunning(options.db, options.task.id);
      const plannedStep=journey?.steps[journeyIndex++];
      const queuedUrl = pending.shift();
      const nextUrl=plannedStep?await resolveJourneyStep(page,startUrl.href,plannedStep):queuedUrl;
      if (!nextUrl || (!journey&&visited.has(nextUrl))) continue;
      visited.add(nextUrl);
      const percent = 10 + Math.round((captured.length / options.task.page_limit) * 62);
      await options.onProgress(percent, "page_loading", plannedStep?`${journeyIndex}/${journey!.steps.length} · ${plannedStep.title}`:`Opening ${new URL(nextUrl).hostname}`);

      try {
        await view?.beforeAction(`正在打开 ${new URL(nextUrl).hostname}`,null);
        await page.goto(nextUrl, { waitUntil: "domcontentloaded" });
        await page.waitForTimeout(PAGE_SETTLE_MS);
        if(options.task.record_video&&!presentation){
          const seconds=(journey?.durationSeconds??options.task.page_limit*6)/(journey?.steps.length??options.task.page_limit);
          const segment=join(tempDir,`page-${segments.length}.webm`);
          await recordPageSegment(page,segment,seconds,plannedStep?.scroll!==false,async()=>{await assertCaptureActive();await view?.beforeAction('连续滚动展示当前页面');},async bytes=>view?.publishFrame(bytes));
          segments.push(segment);segmentDurations.push(seconds);
        }
        const scene=presentation?await capturePresentationScene(page):null;
        await view?.beforeAction("正在读取页面内容");
        await view?.pointAt("h1, h2, main, body", "读取页面内容");
        const facts = pageFactsSchema.parse(
          await page.evaluate(`(${PAGE_FACTS_SCRIPT})(${MAX_HEADINGS})`),
        );
        if(loginScope){
          facts.title=redactLoginText(facts.title,loginScope);
          facts.description=redactLoginText(facts.description,loginScope);
          facts.headings=facts.headings.map(text=>redactLoginText(text,loginScope!));
          facts.navigation=facts.navigation.map(text=>redactLoginText(text,loginScope!));
        }

        const responseUrl = await validatePublicHttpUrl(facts.url);
        if(options.task.login&&!sameWebsiteOrigin(responseUrl.href,startUrl.href))throw new Error("体验页面已离开授权站点。");
        await view?.beforeAction("正在保存页面证据");
        const screenshot = await mosaicScreenshot(page,true,{quality:76,fullPage:false});
        await view?.capture();
        captured.push({
          url: options.task.login?responseUrl.origin+responseUrl.pathname:responseUrl.toString(),
          title: facts.title,
          description: facts.description,
          headings: facts.headings,
          navigation: facts.navigation,
          screenshot,
          width: 1280,
          height: 720,
        });
        if(scene)scenes.push(scene);

        for (const link of journey?[]:facts.links) {
          if (pending.length + captured.length >= options.task.page_limit * 3) break;
          const safeUrl = await validatePublicHttpUrl(link).catch(() => null);
          if(options.task.login&&safeUrl&&(!sameWebsiteOrigin(safeUrl.href,startUrl.href)||/logout|signout|delete|remove|purchase|checkout|payment|退出|删除|支付/i.test(safeUrl.pathname)))continue;
          if (safeUrl && !options.task.follow_external && safeUrl.hostname !== startUrl.hostname) continue;
          if (safeUrl && !visited.has(safeUrl.toString()) && !pending.includes(safeUrl.toString())) {
            pending.push(safeUrl.toString());
          }
        }
      } catch (error) {
        if (journey||captured.length === 0) throw toCaptureError(error);
      }
    }

    if (captured.length === 0) {
      throw new WebsiteCaptureError("no_pages_captured", "No pages could be captured from this website.");
    }
    await closeView("completed", "浏览完成，显示最后画面；证据正在回写任务。");
    await closeCaptureContext(context, networkRequests);
    if (options.task.record_video && !presentation) {
      await options.onProgress(74,'processing_recording','正在去除加载等待并按目标时长整理录像');
      videoPath=await joinCaptureSegments(segments,segmentDurations,tempDir);
    }

    if(presentation){
      await options.onProgress(74,"presentation_recording","正在录制多光标网页重建演示");
      videoPath=await recordWebsitePresentation({browser,directory:tempDir,scenes,config:presentation,
        onPage:async demo=>{
          if(process.env.HELSTERA_BROWSER_VIEW_ENABLED!=="1")return;
          view=await observeAgentBrowser({page:demo,engine:launched.engine,store:browserViewStore(options.db,options.storageRoot),
            taskId:options.task.id,workspaceId:options.task.workspace_id,userId:options.task.created_by,
            name:"网站介绍演示",sourceUrl:startUrl.toString(),assertActive:()=>assertTaskIsRunning(options.db,options.task.id),
            externalFrames:true,
            ...(options.signal?{signal:options.signal}:{}),});
        },
        checkpoint:async()=>{await assertCaptureActive();return await view?.beforeAction("多光标网页重建 · 正在录制",null);},
        onProgress:async progress=>{await options.onProgress(74+Math.round(progress*.18),"presentation_recording",`多光标网页重建演示 ${progress}%`);},
        onFrame:async bytes=>{await view?.publishFrame(bytes);},
      });
      await closeView("completed","网站演示录制完成，视频正在保存。");
    }

    await options.onProgress(presentation?93:78, "saving_assets", "Saving screenshots and recording");
    const pages: WebsiteCapturePage[] = [];
    for (const [index, item] of captured.entries()) {
      await assertTaskIsRunning(options.db, options.task.id);
      const title = `Website screenshot ${index + 1}: ${item.title}`;
      const asset = await persistCaptureAsset({
        db: options.db,
        storage: options.storage,
        storageRoot: options.storageRoot,
        webOrigin: options.webOrigin,
        task: options.task,
        bytes: item.screenshot,
        mimeType: "image/jpeg",
        mediaType: "image",
        title,
        metadata: { sourceUrl: item.url, width: item.width, height: item.height },
      });
      pages.push({
        url: item.url,
        title: item.title,
        description: item.description,
        headings: item.headings,
        navigation: item.navigation,
        assetId: asset.id,
        screenshotUrl: asset.url,
      });
    }

    let recordingAssetId: string | undefined;
    let recordingUrl: string | undefined;
    if (videoPath) {
      const { readFile, stat } = await import("node:fs/promises");
      const videoInfo = await stat(videoPath);
      if (videoInfo.size === 0) {
        throw new WebsiteCaptureError("recording_empty", "The browser recording is empty.");
      }
      if (videoInfo.size > MAX_VIDEO_BYTES) {
        throw new WebsiteCaptureError("recording_too_large", "The browser recording exceeded the 40 MB limit.");
      }
      const video = await readFile(videoPath);
      const asset = await persistCaptureAsset({
        db: options.db,
        storage: options.storage,
        storageRoot: options.storageRoot,
        webOrigin: options.webOrigin,
        task: options.task,
        bytes: video,
        mimeType: "video/webm",
        mediaType: "video",
        title: `${presentation?"网站介绍演示":"Website browsing recording"}: ${pages[0]?.title ?? startUrl.hostname}`,
        metadata: { sourceUrl: startUrl.toString(), pageCount: pages.length,...(presentation?{presentation}:{}),generatedBy:"website-capture" },
      });
      recordingAssetId = asset.id;
      recordingUrl = asset.url;
    }

    const title = pages[0]?.title || startUrl.hostname;
    const evidence = buildWebsiteEvidence(pages);
    const claims = buildWebsiteClaims(startUrl.toString(), pages);
    if(options.task.login)claims[claims.length-1]={text:"本次仅验证已登录账号中实际读取的页面；未执行业务表单、支付或其他修改。",sourceUrls:pages.map(page=>page.url),status:"observed"};
    const introduction = buildWebsiteIntroduction(startUrl.toString(), pages, claims);
    await options.onProgress(96, "writing_report", "Preparing the sourced website introduction");
    capturedSuccessfully = true;
    return {
      title,
      introduction,
      startUrl: startUrl.toString(),
      pages,
      evidence,
      claims,
      ...(recordingAssetId ? { recordingAssetId } : {}),
      ...(recordingUrl ? { recordingUrl } : {}),
      completedAt: new Date().toISOString(),
      ...(presentation?{presentation}:{}),
    };
  } finally {
    networkRequests.abort();
    await view?.close(capturedSuccessfully ? "completed" : "failed", capturedSuccessfully ? "浏览完成" : "浏览已停止，请查看任务结果").catch(error=>console.error("[agent-browser] failed to close preview",error));
    options.signal?.removeEventListener("abort", abort);
    await browser?.close().catch(() => undefined);
    if(options.task.login)await discardWebsiteLogin(options.db,options.task.id);
    await rm(tempDir, { recursive: true, force: true });
  }
}

export async function validatePublicHttpUrl(input: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new WebsiteCaptureError("invalid_url", "Enter a valid website address.");
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new WebsiteCaptureError("blocked_protocol", "Only HTTP and HTTPS websites can be opened.");
  }
  if (url.username || url.password) {
    throw new WebsiteCaptureError("url_credentials_blocked", "Remove credentials from the website address.");
  }
  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local") || hostname.endsWith(".internal")) {
    throw new WebsiteCaptureError("private_address_blocked", "Private and local network addresses are not available in isolated browser mode.");
  }
  const addresses = isIP(hostname)
    ? [{ address: hostname, family: isIP(hostname) }]
    : await lookup(hostname, { all: true, verbatim: true }).catch(() => []);
  if (addresses.length === 0 || addresses.some(({ address }) => !isPublicAddress(address))) {
    throw new WebsiteCaptureError("private_address_blocked", "This address does not resolve exclusively to public internet addresses.");
  }
  url.hash = "";
  return url;
}

export function isPublicAddress(address: string): boolean {
  const normalized = address.toLowerCase().split("%")[0] ?? address;
  if (normalized.startsWith("::ffff:")) {
    const mapped = normalized.slice(7);
    return isIP(mapped) === 4 && isPublicIpv4(mapped);
  }
  if (isIP(normalized) === 4) return isPublicIpv4(normalized);
  if (isIP(normalized) !== 6) return false;
  const value = ipv6ToBigInt(normalized);
  if (value === null) return false;
  const mappedV4 = ipv6PrefixValue(value, 96) === ipv6PrefixValue(ipv6ToBigInt("::ffff:0:0")!, 96);
  if (mappedV4) return isPublicIpv4(Number(value & 0xffff_ffffn).toString(16).padStart(8, "0").match(/.{2}/g)!.map((part) => Number.parseInt(part, 16)).join("."));
  if (
    value === 0n || value === 1n ||
    isInIpv6Range(value, "fc00::", 7) || isInIpv6Range(value, "fe80::", 10) ||
    isInIpv6Range(value, "2001::", 23) || isInIpv6Range(value, "2001:db8::", 32) ||
    isInIpv6Range(value, "2002::", 16) || isInIpv6Range(value, "3fff::", 20) ||
    isInIpv6Range(value, "64:ff9b::", 96) || isInIpv6Range(value, "64:ff9b:1::", 48)
  ) return false;
  return isInIpv6Range(value, "2000::", 3);
}

export async function blockIsolatedWebSocket(route: WebSocketRoute): Promise<void> {
  await route.close({ code: 1008, reason: "WebSocket access is disabled in isolated capture." });
}

export function buildWebsiteEvidence(pages: WebsiteCapturePage[]): WebsiteCaptureEvidence[] {
  return pages.flatMap((page) => [
    { url: page.url, pageTitle: page.title, kind: "title" as const, excerpt: page.title },
    ...(page.description ? [{ url: page.url, pageTitle: page.title, kind: "description" as const, excerpt: page.description }] : []),
    ...page.headings.slice(0, 8).map((heading) => ({ url: page.url, pageTitle: page.title, kind: "heading" as const, excerpt: heading })),
    ...page.navigation.slice(0, 8).map((label) => ({ url: page.url, pageTitle: page.title, kind: "navigation" as const, excerpt: label })),
  ]).slice(0, 128);
}

export function buildWebsiteClaims(startUrl: string, pages: WebsiteCapturePage[]): WebsiteCaptureClaim[] {
  const root = pages[0];
  if (!root) return [{ text: "无法从页面证据确认网站定位、功能或用户路径。", sourceUrls: [], status: "unverified" }];
  const navigation = [...new Set(pages.flatMap((page) => page.navigation))].slice(0, 12);
  return [
    {
      text: root.description || root.title || new URL(startUrl).hostname,
      sourceUrls: [root.url],
      status: "observed",
    },
    {
      text: `已读取 ${pages.length} 个页面，页面标题和摘要如下所列。`,
      sourceUrls: pages.map((page) => page.url),
      status: "observed",
    },
    {
      text: navigation.length ? `主导航可能体现以下用户路径：${navigation.join("、")}。` : "未读取到足够主导航，无法推断用户路径。",
      sourceUrls: pages.filter((page) => page.navigation.length > 0).map((page) => page.url),
      status: navigation.length ? "inferred" : "unverified",
    },
    {
      text: "登录后功能、后台能力、业务真实性和未读取页面内容无法通过本次公开页面证据验证。",
      sourceUrls: [],
      status: "unverified",
    },
  ];
}

export function buildWebsiteIntroduction(startUrl: string, pages: WebsiteCapturePage[], claims = buildWebsiteClaims(startUrl, pages)): string {
  const root = pages[0];
  const siteName = root?.title || new URL(startUrl).hostname;
  const description = root?.description || root?.headings.slice(0, 3).join("、") || "页面未提供可读取的站点简介";
  const pageList = pages.map((page) => `- [${page.title}](${page.url})：${page.description || page.headings.slice(0, 4).join("、") || "页面摘要未提供"}`).join("\n");
  const navigation = [...new Set(pages.flatMap((page) => page.navigation))].slice(0, 12);
  const claimList = claims.map((claim) => {
    const source = claim.sourceUrls.length ? `来源：${claim.sourceUrls.map((url) => `[页面](${url})`).join("、")}` : "无可用来源页面";
    const label = claim.status === "observed" ? "已观测" : claim.status === "inferred" ? "推断" : "无法验证";
    return `- **${label}**：${claim.text}（${source}）`;
  }).join("\n");
  return [
    `## ${siteName}`,
    "",
    `**网站定位**：${description}（依据首页可见描述与标题提取，未验证页面之外的业务事实。）`,
    "",
    "**主要页面**：",
    pageList,
    "",
    `**导航线索**：${navigation.length ? navigation.join("、") : "页面未提供可识别的主导航"}。`,
    "",
    "**结论与证据边界**：",
    claimList,
    "",
    `**访问入口**：${startUrl}`,
  ].join("\n");
}

export function createCaptureByteBudget(limit: number) {
  if (!Number.isSafeInteger(limit) || limit < 0) throw new Error("Invalid capture byte budget.");
  let remaining = limit;
  return {
    exhausted: () => remaining === 0,
    consume: (bytes: number) => {
      if (!Number.isSafeInteger(bytes) || bytes < 0) throw new Error("Invalid capture byte count.");
      if (bytes > remaining) { remaining = 0; return false; }
      remaining -= bytes;
      return true;
    },
  };
}

export async function fulfillBoundedCaptureResponse(
  route: Pick<Route, "abort" | "fulfill">,
  body: NodeJS.ReadableStream & AsyncIterable<Uint8Array>,
  status: number,
  headers: Record<string, string>,
  budget: ReturnType<typeof createCaptureByteBudget>,
  responseLimit = MAX_RESPONSE_BYTES,
): Promise<number> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of body) {
    const part = Buffer.from(chunk);
    total += part.length;
    if (!budget.consume(part.length) || total > responseLimit) {
      abortResponseBody(body);
      await route.abort("blockedbyclient");
      return 0;
    }
    chunks.push(part);
  }
  await route.fulfill({ status, headers, body: Buffer.concat(chunks, total) });
  return total;
}

export async function fulfillPublicReadOnlyRequest(route: Route, budget: ReturnType<typeof createCaptureByteBudget>, login?: LoginNetworkScope, signal?: AbortSignal): Promise<number> {
  const request = route.request();
  const method = request.method().toUpperCase();
  if (login ? !allowLoginRequest(request,login) : method !== "GET" && method !== "HEAD") {
    await route.abort("blockedbyclient");
    return 0;
  }

  const parsedUrl = await validatePublicHttpUrl(request.url()).catch(() => null);
  if (!parsedUrl) {
    await route.abort("blockedbyclient");
    return 0;
  }

  const hostname = parsedUrl.hostname;
  const pinnedAddress = await resolvePublicAddress(hostname).catch(() => null);
  if (!pinnedAddress) {
    await route.abort("blockedbyclient");
    return 0;
  }

  const dispatcher = new Agent({
    connect: {
      lookup: ((
        _host: string,
        lookupOptions: unknown,
        callback: (...args: unknown[]) => void,
      ) => {
        const resolved = { address: pinnedAddress.address, family: pinnedAddress.family };
        const all = typeof lookupOptions === "object" && lookupOptions !== null && "all" in lookupOptions && lookupOptions.all === true;
        if (all) callback(null, [resolved]);
        else callback(null, resolved.address, resolved.family);
      }) as never,
    },
  });

  try {
    const sameOrigin = login && (parsedUrl.origin===login.origin||login.human&&login.allowedOrigins?.includes(parsedUrl.origin));
    const verification=login?.human&&isLoginVerificationUrl(parsedUrl);
    const browserHeaders = sameOrigin||verification ? await request.allHeaders() : {};
    const response = await httpRequest(parsedUrl, {
      dispatcher,
      ...(signal ? { signal } : {}),
      method:method as "GET"|"HEAD"|"POST"|"OPTIONS",
      ...(method==="POST"?{body:request.postDataBuffer()??null}:{}),
      headersTimeout: PAGE_TIMEOUT_MS,
      bodyTimeout: PAGE_TIMEOUT_MS,
      headers: {
        accept: request.headers().accept ?? "text/html,application/xhtml+xml,image/avif,image/webp,*/*;q=0.8",
        "accept-language": request.headers()["accept-language"] ?? "zh-CN,zh;q=0.9,en;q=0.8",
        "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/132 Safari/537.36 HelsteraCapture/1.0",
        ...Object.fromEntries(["cookie","authorization","content-type","origin","referer","x-csrf-token","x-xsrf-token"].flatMap(key=>browserHeaders[key]?[[key,browserHeaders[key]!]]:[])),
      },
    });
    const headers = selectResponseHeaders(response.headers as Record<string, string | string[] | undefined>);
    if((sameOrigin||verification)&&response.headers["set-cookie"])headers["set-cookie"]=[response.headers["set-cookie"]].flat().join("\n");
    if(verification)for(const key of ['access-control-allow-origin','access-control-allow-credentials','access-control-allow-headers','access-control-allow-methods']){const value=response.headers[key];if(typeof value==='string')headers[key]=value;}
    if (method === "HEAD" || response.statusCode === 204 || response.statusCode === 304 || (response.statusCode >= 300 && response.statusCode < 400)) {
      await route.fulfill({ status: response.statusCode, headers, body: Buffer.alloc(0) });
      abortResponseBody(response.body);
      return 0;
    }

    const declaredLength = Number(response.headers["content-length"] ?? 0);
    if (declaredLength > MAX_RESPONSE_BYTES) {
      abortResponseBody(response.body);
      await route.abort("blockedbyclient");
      return 0;
    }
    return await fulfillBoundedCaptureResponse(route, response.body, response.statusCode, headers, budget);
  } catch (error) {
    console.warn("[website-capture] public request blocked", {
      host: parsedUrl.hostname,
      reason: login ? "Authenticated request failed" : error instanceof Error ? error.message.slice(0, 240) : String(error).slice(0, 240),
    });
    await route.abort("failed").catch(() => undefined);
    return 0;
  } finally {
    await dispatcher.close();
  }
}

export function abortResponseBody(body: NodeJS.ReadableStream) {
  body.once("error", () => undefined);
  if ("destroy" in body && typeof body.destroy === "function") {
    body.destroy();
  }
}

async function resolvePublicAddress(hostname: string) {
  const records = isIP(hostname)
    ? [{ address: hostname, family: isIP(hostname) }]
    : await lookup(hostname, { all: true, verbatim: true });
  if (records.length === 0 || records.some(({ address }) => !isPublicAddress(address))) return null;
  return records[0]!;
}

function isPublicIpv4(address: string) {
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b, c] = octets as [number, number, number, number];
  return !(
    a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && ((b === 0 && (c === 0 || c === 2)) || b === 168)) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113) ||
    (a === 192 && b === 88 && c === 99)
  );
}

function ipv6ToBigInt(address: string): bigint | null {
  let normalized = address.toLowerCase();
  if (normalized.includes(".")) {
    const lastColon = normalized.lastIndexOf(":");
    const ipv4 = normalized.slice(lastColon + 1).split(".").map(Number);
    if (ipv4.length !== 4 || ipv4.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
    const high = ((ipv4[0]! << 8) | ipv4[1]!).toString(16);
    const low = ((ipv4[2]! << 8) | ipv4[3]!).toString(16);
    normalized = `${normalized.slice(0, lastColon)}:${high}:${low}`;
  }
  const halves = normalized.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves[1] ? halves[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) return null;
  const groups = [...left, ...Array.from({ length: halves.length === 2 ? missing : 0 }, () => "0"), ...right];
  if (groups.length !== 8 || groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return null;
  return groups.reduce((value, group) => (value << 16n) | BigInt(`0x${group}`), 0n);
}

function ipv6PrefixValue(value: bigint, prefixLength: number) {
  return value >> BigInt(128 - prefixLength);
}

function isInIpv6Range(value: bigint, prefix: string, prefixLength: number) {
  const prefixValue = ipv6ToBigInt(prefix);
  return prefixValue !== null && ipv6PrefixValue(value, prefixLength) === ipv6PrefixValue(prefixValue, prefixLength);
}

function selectResponseHeaders(input: Record<string, string | string[] | undefined>): Record<string, string> {
  const allowed = new Set([
    "content-type", "content-language", "content-encoding", "content-length", "content-range",
    "cache-control", "expires", "last-modified", "etag", "location", "accept-ranges",
  ]);
  return Object.fromEntries(Object.entries(input)
    .filter(([key, value]) => allowed.has(key.toLowerCase()) && typeof value === "string")
    .map(([key, value]) => [key.toLowerCase(), value as string]));
}

export async function persistCaptureAsset(input: {
  db: Pool;
  storage: StorageProvider;
  storageRoot: string;
  webOrigin: string;
  task: CaptureTask;
  bytes: Buffer;
  mimeType: string;
  mediaType: "image" | "video";
  title: string;
  metadata: Record<string, unknown>;
}) {
  const extension = input.mimeType === "video/webm" ? "webm" : "jpg";
  const objectPath = `${input.task.workspace_id}/generated/website-capture/${input.task.id}/${randomUUID()}.${extension}`;
  const upload = await input.storage.upload("project-assets", objectPath, input.bytes, {
    contentType: input.mimeType,
    upsert: false,
  });
  if (upload.error) throw new Error(`Could not save capture asset: ${upload.error.message}`);

  let client: PoolClient | undefined;
  try {
    client = await input.db.connect();
    await client.query("begin");
    const asset = await client.query<{ id: string }>(
      `insert into asset_objects(workspace_id, bucket, object_path, mime_type, byte_size, created_by)
       values($1, 'project-assets', $2, $3, $4, $5) returning id`,
      [input.task.workspace_id, objectPath, input.mimeType, input.bytes.length, input.task.created_by],
    );
    const assetId = asset.rows[0]?.id;
    if (!assetId) throw new Error("Asset metadata could not be saved.");
    await client.query(
      `insert into generated_assets(workspace_id, created_by, media_type, object_path, mime_type, title, description, prompt, metadata, website_capture_task_id)
       values($1, $2, $3, $4, $5, $6, $7, '', $8::jsonb, $9)`,
      [input.task.workspace_id, input.task.created_by, input.mediaType, objectPath, input.mimeType, input.title, "Captured from a website selected by the workspace user.", JSON.stringify(input.metadata), input.task.id],
    );
    await client.query("commit");
    return { id: assetId, url: `${input.webOrigin}/api/uploads/${assetId}/file` };
  } catch (error) {
    await client?.query("rollback").catch(() => undefined);
    await input.storage.remove("project-assets", [objectPath]).catch(() => undefined);
    throw error;
  } finally {
    client?.release();
  }
}

async function assertTaskIsRunning(db: Pool, taskId: string) {
  const { rows } = await db.query<{ status: string }>("select status from website_capture_tasks where id=$1", [taskId]);
  if (rows[0]?.status === "canceled") {
    throw new WebsiteCaptureError("job_canceled", "Website capture was canceled by the user.");
  }
  if (rows[0]?.status !== "running") {
    throw new WebsiteCaptureError("task_unavailable", "Website capture is no longer active.");
  }
}

function buildWebsiteIntroductionFallback(startUrl: string, pages: WebsiteCapturePage[]): string {
  const root = pages[0];
  const siteName = root?.title || new URL(startUrl).hostname;
  const description = root?.description || root?.headings.slice(0, 3).join("、") || "页面未提供可读取的站点简介";
  const pageList = pages.map((page) => `- [${page.title}](${page.url})：${page.description || page.headings.slice(0, 4).join("、") || "页面摘要未提供"}`).join("\n");
  const navigation = [...new Set(pages.flatMap((page) => page.navigation))].slice(0, 12);
  return [
    `## ${siteName}`,
    "",
    `**网站定位**：${description}（依据页面公开标题与描述提取，未验证页面之外的业务事实。）`,
    "",
    "**主要页面**：",
    pageList,
    "",
    `**导航线索**：${navigation.length ? navigation.join("、") : "页面未提供可识别的主导航"}。`,
    "",
    `**访问入口**：${startUrl}`,
  ].join("\n");
}

function toCaptureError(error: unknown): WebsiteCaptureError {
  if (error instanceof WebsiteCaptureError) return error;
  const message = error instanceof Error ? error.message : "The website could not be opened.";
  return new WebsiteCaptureError("browser_navigation_failed", message.slice(0, 500));
}
