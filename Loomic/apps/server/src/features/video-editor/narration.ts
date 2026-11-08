import {spawn} from 'node:child_process';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
export type NarrationScript={text:string;voice:'cmn'|'en-us';rate:number};
export async function synthesizeNarration(input:NarrationScript){
 const folder=await mkdtemp(join(tmpdir(),'loomic-voice-')),path=join(folder,'voice.wav');
 try{
  await new Promise<void>((resolve,reject)=>{
   const child=spawn(process.env.HELSTERA_TTS_BINARY??'espeak-ng',['-v',input.voice,'-s',String(input.rate),'-w',path,'--stdin'],{windowsHide:true,stdio:['pipe','ignore','pipe']});
   const timer=setTimeout(()=>{child.kill();reject(new Error('配音生成超时。'));},30000);
   child.stdin.on('error',()=>undefined);child.once('error',()=>{clearTimeout(timer);reject(new Error('本地配音引擎不可用，请联系管理员。'));});child.once('close',code=>{clearTimeout(timer);code===0?resolve():reject(new Error('本地配音生成失败。'));});child.stdin.end(input.text);
  });
  const bytes=await readFile(path);if(bytes.length<44||bytes.toString('ascii',0,4)!=='RIFF'||bytes.length>20*1024*1024)throw new Error('配音未生成有效音频。');return bytes;
 }finally{await rm(folder,{recursive:true,force:true});}
}
