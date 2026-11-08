import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { errors, type Page } from "playwright";
import { CAPTURE_FPS, frameEncoder } from "./video-encoder.js";

const require = createRequire(import.meta.url);
const CHECKPOINT_FRAMES = 15;
const MAX_RENDER_MS = 17 * 60_000;
const APP_READY_TIMEOUT_MS = 15_000;
const APP_READY_SCRIPT = `(() => {
  const loading = document.querySelectorAll('[aria-busy="true"],[role="status"],[role="progressbar"]');
  return !Array.from(loading).some(el => {
    const box = el.getBoundingClientRect(), css = getComputedStyle(el);
    if (box.width < innerWidth * .5 || box.height < innerHeight * .5 ||
        box.bottom <= 0 || box.right <= 0 || box.top >= innerHeight || box.left >= innerWidth ||
        css.display === 'none' || css.visibility === 'hidden' || Number(css.opacity) === 0) return false;
    const label = (el.getAttribute('aria-label') ?? '') + ' ' + (el.textContent ?? '').slice(0, 200);
    return el.getAttribute('aria-busy') === 'true' || /loading|buffering|please wait|加载|载入|请稍候|初始化/i.test(label);
  });
})()`;

export async function waitForRecordingPage(page: Page) {
  for (const state of ["load", "networkidle"] as const) {
    await page.waitForLoadState(state, { timeout: state === "load" ? 10_000 : 8_000 }).catch(error => {
      if (error.name !== "TimeoutError") throw error;
    });
  }
  await page.evaluate("Promise.race([Promise.all([document.fonts.ready,...Array.from(document.images).filter(img=>img.getBoundingClientRect().top<innerHeight*2).map(img=>img.decode().catch(()=>undefined))]),new Promise(resolve=>setTimeout(resolve,3000))]).then(()=>undefined)");
  try {
    await page.waitForFunction(APP_READY_SCRIPT, undefined, { timeout: APP_READY_TIMEOUT_MS, polling: 100 });
  } catch (error) {
    if (!(error instanceof errors.TimeoutError)) throw error;
    throw new Error("网页仍在加载，未开始录制。请稍后重试。", { cause: error });
  }
  await page.waitForTimeout(500);
}

async function prepareScroll(page: Page, seconds: number, scroll: boolean) {
  await page.addScriptTag({ content: await readFile(require.resolve("gsap/dist/gsap.min.js"), "utf8") });
  await page.evaluate(`(() => {
    const candidates=Array.from(document.querySelectorAll('main,[role="main"],div,section')).filter(el=>{
      const box=el.getBoundingClientRect(),css=getComputedStyle(el);
      return box.width>innerWidth*.4&&box.height>innerHeight*.4&&el.scrollHeight>el.clientHeight+40&&/auto|scroll/.test(css.overflowY);
    });
    candidates.sort((a,b)=>(Number(b.matches('main,[role="main"]'))-Number(a.matches('main,[role="main"]')))||b.clientWidth*b.clientHeight-a.clientWidth*a.clientHeight);
    const target=candidates[0]??document.scrollingElement,state={y:0};
    const end=${scroll ? "Math.min(Math.max(0,target.scrollHeight-target.clientHeight),1440)" : "0"};
    target.style.setProperty('scroll-behavior','auto','important');target.scrollTop=0;
    const timeline=gsap.timeline({paused:true});
    const update=()=>{target.scrollTop=state.y;};
    timeline.to(state,{y:end,duration:${seconds}*.9,ease:'sine.inOut',onUpdate:update},${seconds}*.05);
    window.__loomicScroll=timeline;
  })()`);
}

export async function recordPageSegment(
  page: Page,
  path: string,
  seconds: number,
  scroll: boolean,
  checkpoint: () => Promise<unknown>,
  onFrame?: (bytes: Buffer) => Promise<void>,
) {
  if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 60) throw new Error("页面录制时长无效。");
  await waitForRecordingPage(page);
  await checkpoint();
  await prepareScroll(page, seconds, scroll);
  const encoder = frameEncoder(path);
  const count = Math.round(seconds * CAPTURE_FPS), deadline = Date.now() + MAX_RENDER_MS;
  let finished = false;
  try {
    // The browser screencast may omit compositor frames. Sample the authored scroll
    // position explicitly so a slow observer never creates repeated output frames.
    for (let frame = 0; frame < count; frame++) {
      if (Date.now() > deadline) throw new Error("页面录像渲染超时，请缩短时长后重试。");
      if (frame % CHECKPOINT_FRAMES === 0) await checkpoint();
      await page.evaluate(`(()=>{window.__loomicScroll.seek(${frame / CAPTURE_FPS},false);})()`);
      const bytes = await page.screenshot({ type: "jpeg", quality: 85, timeout: 10_000 });
      await encoder.frame(bytes);
      if (frame % CHECKPOINT_FRAMES === 0) await onFrame?.(bytes);
    }
    await encoder.close();
    finished = true;
  } finally {
    if (!finished) await encoder.abort();
    if (!page.isClosed()) await page.evaluate("(()=>{window.__loomicScroll?.kill();})()");
  }
}
