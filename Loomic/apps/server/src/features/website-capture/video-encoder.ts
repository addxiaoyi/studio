import { spawn } from "node:child_process";
import { once } from "node:events";
import { rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const CAPTURE_FPS=60;
// Leave room below the 40 MiB / 60 s upload limit for keyframes and container overhead.
const VIDEO_BITRATE = '3M';
const VIDEO_BUFFER = '6M';
const MAX_BYTES_PER_SECOND = 600 * 1024;
export function ffmpegBinary(){return process.env.HELSTERA_FFMPEG??'ffmpeg';}
export function frameEncoder(path:string){
  const child=spawn(ffmpegBinary(),[
    '-hide_banner','-loglevel','error','-y','-f','image2pipe','-vcodec','mjpeg',
    '-framerate',String(CAPTURE_FPS),'-i','pipe:0','-an','-c:v','libvpx',
    '-deadline','realtime','-cpu-used','6','-threads','2',
    '-b:v',VIDEO_BITRATE,'-minrate',VIDEO_BITRATE,'-maxrate',VIDEO_BITRATE,'-bufsize',VIDEO_BUFFER,
    '-qmin','0','-qmax','63','-drop-threshold','0','-g',String(CAPTURE_FPS*2),'-pix_fmt','yuv420p',path,
  ],{windowsHide:true,stdio:['pipe','ignore','pipe']});
  let diagnostic='',failure:Error|undefined,frames=0;child.stderr.on('data',chunk=>diagnostic=(diagnostic+String(chunk)).slice(-1000));child.stdin.on('error',error=>{failure=error;});
  const done=new Promise<void>((resolve,reject)=>{child.once('error',reject);child.once('close',code=>code===0?resolve():reject(new Error(`网站视频编码失败（${code}）：${diagnostic}`)));});
  void done.catch(()=>undefined);
  return {
    async frame(bytes:Buffer){if(failure)throw failure;if(!child.stdin.write(bytes))await Promise.race([once(child.stdin,'drain'),done]);frames++;},
    async close(){child.stdin.end();await done;await boundRecordingSize(path,frames);},
    async abort(){child.kill();await done.catch(()=>undefined);},
  };
}

async function boundRecordingSize(path: string, frames: number) {
  const limit = Math.ceil(frames / CAPTURE_FPS * MAX_BYTES_PER_SECOND);
  if ((await stat(path)).size <= limit) return;
  // VP8 plays on the desktop runtime, but its bitrate floor can exceed the upload
  // budget on noisy pages. Reduce high-frequency noise only for oversized output.
  const compressed = `${path}.bounded.webm`;
  try {
    await runCaptureFfmpeg(['-i',path,'-vf','gblur=sigma=1.2','-an','-c:v','libvpx',
      '-deadline','realtime','-cpu-used','6','-threads','2','-b:v',VIDEO_BITRATE,
      '-minrate',VIDEO_BITRATE,'-maxrate',VIDEO_BITRATE,'-bufsize',VIDEO_BUFFER,
      '-qmin','0','-qmax','63','-drop-threshold','0','-g',String(CAPTURE_FPS*2),
      '-fps_mode','passthrough','-pix_fmt','yuv420p',compressed]);
    if ((await stat(compressed)).size > limit) throw new Error('录像画面过于复杂，请缩短录制时长后重试。');
    await rename(compressed,path);
  } finally { await rm(compressed,{force:true}); }
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
    await runCaptureFfmpeg(['-i',path,'-an','-t',String(seconds),'-c:v','copy',target]);normalized.push(target);
  }
  const manifest=join(directory,'segments.txt');await writeFile(manifest,normalized.map(path=>`file '${path.replaceAll('\\','/').replaceAll("'","'\\''")}'`).join('\n'));
  const output=join(directory,'website-recording.webm');await runCaptureFfmpeg(['-f','concat','-safe','0','-i',manifest,'-c','copy',output]);return output;
}
