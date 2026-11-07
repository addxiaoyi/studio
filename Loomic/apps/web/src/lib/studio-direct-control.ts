import type { VideoStudioControl } from "@helstera/shared";

export function studioDirectControl(prompt:string):VideoStudioControl|null {
  const text=prompt.trim().replace(/[。.!！]$/,"");
  if(/^(?:播放|开始播放)(?:当前)?(?:视频|预览)?$|^play(?: (?:video|preview))?$/i.test(text))return {type:"play"};
  if(/^(?:暂停|暂停播放)(?:当前)?(?:视频|预览)?$|^pause(?: (?:video|preview))?$/i.test(text))return {type:"pause"};
  const seek=text.match(/^(?:定位到|跳到)(\d+(?:\.\d+)?)秒$|^seek to (\d+(?:\.\d+)?)s(?:econds)?$/i);
  if(seek)return {type:"seek",seconds:Number(seek[1]??seek[2])};
  if(/^(?:静音|预览静音|mute)$/i.test(text))return {type:"mute",muted:true};
  if(/^(?:取消静音|恢复声音|unmute)$/i.test(text))return {type:"mute",muted:false};
  if(/^(?:导出|导出视频|打开导出设置|export)$/i.test(text))return {type:"export"};
  if(/^(?:撤销最近修改|撤销上次修改|undo last edit)$/i.test(text))return {type:"undo"};
  return null;
}
