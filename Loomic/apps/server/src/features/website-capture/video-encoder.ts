import { spawn } from "node:child_process";
import { once } from "node:events";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

export const CAPTURE_FPS=30;
export function ffmpegBinary(){return process.env.HELSTERA_FFMPEG??'ffmpeg';}
export function frameEncoder(path:string){
  const child=spawn(ffmpegBinary(),['-hide_banner','-loglevel','error','-y','-f','image2pipe','-vcodec','mjpeg','-framerate',String(CAPTURE_FPS),'-i','pipe:0','-an','-c:v','libvpx-vp9','-deadline','realtime','-cpu-used','6','-threads','2','-row-mt','1','-b:v','0','-crf','28','-pix_fmt','yuv420p',path],{windowsHide:true,stdio:['pipe','ignore','pipe']});
  let diagnostic='',failure:Error|undefined;child.stderr.on('data',chunk=>diagnostic=(diagnostic+String(chunk)).slice(-1000));child.stdin.on('error',error=>{failure=error;});
  const done=new Promise<void>((resolve,reject)=>{child.once('error',reject);child.once('close',code=>code===0?resolve():reject(new Error(`网站视频编码失败（${code}）：${diagnostic}`)));});
  void done.catch(()=>undefined);
  return {
    async frame(bytes:Buffer){if(failure)throw failure;if(!child.stdin.write(bytes))await Promise.race([once(child.stdin,'drain'),done]);},
    async close(){child.stdin.end();await done;},
    async abort(){child.kill();await done.catch(()=>undefined);},
  };
}
export async function runCaptureFfmpeg(args:string[],timeoutMs=120000){
  await new Promise<void>((resolve,reject)=>{
    const child=spawn(ffmpegBinary(),['-hide_banner','-loglevel','error','-y',...args],{windowsHide:true,stdio:['ignore','ignore','pipe']});let diagnostic='';
    const timer=setTimeout(()=>{child.kill();reject(new Error('网站录像编码超时。'));},timeoutMs);
    child.stderr.on('data',chunk=>diagnostic=(diagnostic+String(chunk)).slice(-1200));child.once('error',error=>{clearTimeout(timer);reject(error);});child.once('close',code=>{clearTimeout(timer);code===0?resolve():reject(new Error(`网站录像处理失败（${code}）：${diagnostic}`));});
  });
}
export async function joinCaptureSegments(paths:string[],durations:number[],directory:string){
  if(!paths.length||paths.length!==durations.length)throw new Error('录制缺少完整页面片段。');
  const normalized:string[]=[];
  for(const [index,path] of paths.entries()){
    const seconds=durations[index]!;if(!Number.isFinite(seconds)||seconds<=0||seconds>60)throw new Error('录制时长无效。');
    const target=join(directory,`ready-${index}.webm`);
    await runCaptureFfmpeg(['-i',path,'-an','-vf',`fps=${CAPTURE_FPS},tpad=stop_mode=clone:stop_duration=${seconds},trim=duration=${seconds},setpts=PTS-STARTPTS`,'-c:v','libvpx-vp9','-deadline','realtime','-cpu-used','6','-threads','2','-row-mt','1','-b:v','0','-crf','28','-pix_fmt','yuv420p',target]);normalized.push(target);
  }
  const manifest=join(directory,'segments.txt');await writeFile(manifest,normalized.map(path=>`file '${path.replaceAll('\\','/').replaceAll("'","'\\''")}'`).join('\n'));
  const output=join(directory,'website-recording.webm');await runCaptureFfmpeg(['-f','concat','-safe','0','-i',manifest,'-c','copy',output]);return output;
}
