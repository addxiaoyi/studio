"use client";
import { useRef,useState,type PointerEvent,type KeyboardEvent } from "react";
import type { AgentBrowserSession,WebsiteHandoffInput } from "@helstera/shared";
import { Button } from "@/components/ui/button";
import { sendBrowserHandoff,readHandoffReceipt } from "@/lib/agent-browser-api";

export function WebsiteHandoffView({token,session,frame,ready}:{token:string;session:AgentBrowserSession;frame:string;ready:boolean}){
  const [busy,setBusy]=useState(false),[text,setText]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const lock=useRef(false),down=useRef<{x:number;y:number}|null>(null);
  async function send(input:WebsiteHandoffInput){
    if(lock.current||!ready)return;lock.current=true;setBusy(true);setError('');setNotice('正在操作登录页面…');
    const id=crypto.randomUUID();
    try{
      let receipt=await sendBrowserHandoff(token,session,input,id);
      const deadline=Date.now()+22000;
      while(['pending','claimed'].includes(receipt.status)&&Date.now()<deadline){await new Promise(resolve=>setTimeout(resolve,400));receipt=await readHandoffReceipt(token,id);}
      if(receipt.status!=='succeeded')throw new Error(receipt.status==='failed'?'登录尚未完成或画面已变化，请查看当前画面后重试。':'没有收到确定回执，请先查看当前画面；操作不会自动重复。');
      setNotice(input.kind==='resume'?'验证完成，Agent 正在继续原任务。':'已操作，请查看当前画面。');
    }catch(cause){setError(cause instanceof Error?cause.message:'操作未确认，请查看画面后再决定是否重试。');setNotice('');}
    finally{lock.current=false;setBusy(false);}
  }
  function point(event:PointerEvent<HTMLDivElement>){const box=event.currentTarget.getBoundingClientRect();return{x:Math.max(0,Math.min(1,(event.clientX-box.left)/box.width)),y:Math.max(0,Math.min(1,(event.clientY-box.top)/box.height))};}
  function begin(event:PointerEvent<HTMLDivElement>){if(lock.current||!ready)return;down.current=point(event);event.currentTarget.setPointerCapture(event.pointerId);}
  function finish(event:PointerEvent<HTMLDivElement>){const start=down.current;down.current=null;if(!start)return;const end=point(event);void send(Math.hypot(start.x-end.x,start.y-end.y)>.012?{kind:'drag',...start,toX:end.x,toY:end.y}:{kind:'click',...end});}
  function key(event:KeyboardEvent<HTMLDivElement>){if(!['Enter','ArrowDown','ArrowUp','ArrowLeft','ArrowRight'].includes(event.key))return;event.preventDefault();void send({kind:'key',key:event.key as 'Enter'});}
  function insert(){const value=text;setText('');if(value)void send({kind:'text',text:value});}
  return <section className="website-handoff" aria-label="人工接管登录">
    <div><h3 className="text-sm font-semibold">需要你完成登录验证</h3><p className="mt-1 text-xs text-muted-foreground">点击或拖动下面的真实画面，或用手机扫码。密码和验证码内容已隐藏，登录画面不会进入录像；完成后继续同一任务。</p></div>
    {frame?<div className="website-handoff-preview" role="group" tabIndex={0} aria-label="登录页面操作区域" onPointerDown={begin} onPointerUp={finish} onPointerCancel={()=>{down.current=null;}} onKeyDown={key}><img src={frame} alt="待接管的登录页面" draggable={false}/></div>:<p role="status">正在读取登录页面…</p>}
    <label className="text-xs">输入到页面选中的控件<input className="website-presentation-input mt-1" type="password" value={text} maxLength={256} onChange={event=>setText(event.target.value)} autoComplete="off" placeholder="先点击页面输入框，确认下方焦点提示，再输入"/></label>
    <div className="website-handoff-toolbar">
      <Button size="sm" variant="outline" disabled={busy||!ready||!text} onClick={insert}>输入文字</Button>
      <Button size="sm" variant="outline" disabled={busy||!ready} onClick={()=>void send({kind:'key',key:'Tab'})}>下一控件</Button>
      <Button size="sm" variant="outline" disabled={busy||!ready} onClick={()=>void send({kind:'key',key:'Enter'})}>确认输入</Button>
      <Button size="sm" variant="ghost" disabled={busy||!ready} onClick={()=>void send({kind:'scroll',delta:480})}>向下滚动</Button>
      <Button size="sm" variant="ghost" disabled={busy||!ready} onClick={()=>void send({kind:'scroll',delta:-480})}>向上滚动</Button>
    </div>
    <Button size="sm" disabled={busy||!frame||!ready} onClick={()=>void send({kind:'resume'})}>验证完成，继续录制</Button>
    {!ready&&<p role="status" className="text-xs text-muted-foreground">正在更新登录画面…</p>}
    {notice&&<p role="status" className="text-xs text-muted-foreground">{notice}</p>}{error&&<p role="alert" className="text-xs text-destructive">{error}</p>}
  </section>;
}
