import {mkdtemp,readFile,mkdir,copyFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {expect,it} from 'vitest';
import {launchAgentBrowser} from '../agent-browser/engine.js';
import {installPrivacyMosaic,mosaicScreenshot} from '../agent-browser/privacy-mosaic.js';
import {recordPageSegment} from './page-recording.js';
import {joinCaptureSegments,ffmpegBinary} from './video-encoder.js';
import sharp from 'sharp';
const evidence=process.env.HELT_CAPTURE_TEST_OUTPUT??resolve('../../.creative-test-results/recording-quality');
it('uses a value-independent mosaic and retains editability',async()=>{
 const {browser}=await launchAgentBrowser();try{
  const context=await browser.newContext();await installPrivacyMosaic(context);const page=await context.newPage();
  await page.setContent('<input type="password" value="secret-one" style="position:absolute;left:50px;top:50px;width:300px;height:50px"><h1>Site</h1>');
  const before=await mosaicScreenshot(page,true);await page.locator('input').fill('secret-two');await page.locator('h1').click();
  expect(await mosaicScreenshot(page,true)).toEqual(before);
  const {data}=await sharp(before).extract({left:80,top:60,width:96,height:24}).raw().toBuffer({resolveWithObject:true});
  const shades=new Set(Array.from({length:data.length/3},(_,i)=>Math.round(data[i*3]!/10)));expect(shades.size).toBeGreaterThan(3);
  expect(await page.locator('input').inputValue()).toBe('secret-two');await mkdir(evidence,{recursive:true});await copyFile(await writePreview(before),join(evidence,'mosaic.jpg'));
  await page.route('https://privacy.example/',route=>route.fulfill({contentType:'text/html',body:'<input type="email" value="sensitive-invalid">'}));await page.goto('https://privacy.example/');
  expect(await page.evaluate("(()=>{let prevented=false;document.addEventListener('invalid',event=>{prevented=event.defaultPrevented;},true);document.querySelector('input').reportValidity();return prevented;})()")).toBe(true);
 }finally{await browser.close();}
});
async function writePreview(bytes:Buffer){const {writeFile}=await import('node:fs/promises');const path=join(evidence,'mosaic-source.jpg');await writeFile(path,bytes);return path;}
it.each([false,true])('records continuous movement after page readiness with nested scroll=%s',async nested=>{
 const {browser}=await launchAgentBrowser();const directory=await mkdtemp(join(tmpdir(),'capture-quality-'));
 try{
  const context=await browser.newContext({viewport:{width:1280,height:720}});await installPrivacyMosaic(context);const page=await context.newPage();
  await page.setContent('<body style="margin:0;background:#eee">'+(nested?'<main style="height:720px;overflow:auto">':'')+Array.from({length:20},(_,i)=>`<section style="height:180px;background:hsl(${i*17} 60% 60%);font:60px sans-serif">Section ${i}</section>`).join('')+(nested?'</main>':'')+'</body>');
  const frames:number[]=[];await page.exposeFunction('sampleScroll',(y:number)=>frames.push(y));
  await page.evaluate(`(()=>{let last=0;const target=${nested?"document.querySelector('main')":"document.scrollingElement"};function sample(){const y=target.scrollTop;if(y!==last){window.sampleScroll(y);last=y;}requestAnimationFrame(sample);}requestAnimationFrame(sample);})()`);
  const segment=join(directory,'source.webm');await recordPageSegment(page,segment,3,true,async()=>{});
  expect(frames.length).toBeGreaterThan(35);
  const deltas=frames.slice(1).map((y,i)=>Math.abs(y-frames[i]!));expect(deltas.filter(d=>d>400)).toHaveLength(0);
  const file=await joinCaptureSegments([segment],[3],directory);
  const decoded=spawnSync(ffmpegBinary(),['-hide_banner','-xerror','-i',file,'-f','null','-'],{windowsHide:true,encoding:'utf8'});
  expect(decoded.status,decoded.stderr).toBe(0);expect(decoded.stderr).toContain('00:00:03.00');expect(decoded.stderr).toContain('30 fps');
  await mkdir(evidence,{recursive:true});await copyFile(file,join(evidence,nested?'smooth-nested-scrolling.webm':'smooth-scrolling.webm'));
 }finally{await browser.close();}
},60000);
