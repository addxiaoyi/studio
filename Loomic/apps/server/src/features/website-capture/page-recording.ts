import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import type { Page } from "playwright";
const require=createRequire(import.meta.url);
export async function waitForRecordingPage(page:Page){
  await page.waitForLoadState('load',{timeout:10000}).catch(error=>{if(error.name!=='TimeoutError')throw error;});
  await page.waitForLoadState('networkidle',{timeout:8000}).catch(error=>{if(error.name!=='TimeoutError')throw error;});
  await page.evaluate(`Promise.race([Promise.all([document.fonts.ready,...Array.from(document.images).filter(img=>img.getBoundingClientRect().top<innerHeight*2).map(img=>img.decode().catch(()=>undefined))]),new Promise(resolve=>setTimeout(resolve,3000))]).then(()=>undefined)`);
  await page.waitForTimeout(500);
}
export async function recordPageSegment(page:Page,path:string,seconds:number,scroll:boolean,checkpoint:()=>Promise<unknown>,onFrame?:(bytes:Buffer)=>Promise<void>){
  await waitForRecordingPage(page);await checkpoint();
  await page.addScriptTag({content:await readFile(require.resolve('gsap/dist/gsap.min.js'),'utf8')});
  let publish=Promise.resolve();
  await page.screencast.start({path,size:{width:1280,height:720},quality:85,onFrame:frame=>{if(onFrame)publish=publish.then(()=>onFrame(frame.data));}});
  try{
    await page.evaluate(`(()=>{const state={y:0},end=${scroll?'Math.min(Math.max(0,Math.max(document.body.scrollHeight,document.documentElement.scrollHeight)-innerHeight),1440)':'0'};window.__loomicScroll=gsap.timeline({paused:true});window.__loomicScroll.to(state,{y:end,duration:${seconds}*.72,ease:'sine.inOut',onUpdate:()=>scrollTo(0,state.y)},${seconds}*.06).to(state,{y:0,duration:${seconds}*.16,ease:'sine.inOut',onUpdate:()=>scrollTo(0,state.y)},${seconds}*.82);window.__loomicScroll.play();})()`);
    const until=Date.now()+seconds*1000;
    while(Date.now()<until){await page.waitForTimeout(Math.min(350,until-Date.now()));await checkpoint();}
  }finally{await page.screencast.stop();await publish;await page.evaluate('window.__loomicScroll?.kill()');}
}
