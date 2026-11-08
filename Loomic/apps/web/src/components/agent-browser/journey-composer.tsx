"use client";
import { useEffect,useState,type FormEvent } from "react";
import { ArrowUp,Route } from "lucide-react";
import type { WebsiteJourney,WebsiteJourneyPlan,WebsiteLoginCredentials,WebsitePresentation } from "@helstera/shared";
import { Button } from "@/components/ui/button";
import { StyledSelect } from "@/components/ui/styled-select";
import { WebsiteLoginFields } from "./website-login-fields";
import { planWebsiteJourney,listWebsiteSessions,forgetWebsiteSession,type SavedWebsiteSession } from "@/lib/website-journey-api";

export function WebsiteJourneyComposer({token,sourceUrl,busy,onStart}:{token:string;sourceUrl:string;busy:boolean;onStart:(url:string,presentation?:WebsitePresentation,login?:WebsiteLoginCredentials,journey?:WebsiteJourney,startNow?:boolean)=>Promise<void>}){
  const [url,setUrl]=useState(sourceUrl),[goal,setGoal]=useState(''),[planning,setPlanning]=useState(false),[error,setError]=useState('');
  const [plan,setPlan]=useState<WebsiteJourneyPlan|null>(null),[plannedGoal,setPlannedGoal]=useState(''),[method,setMethod]=useState('none');
  const [sessions,setSessions]=useState<SavedWebsiteSession[]>([]),[credentials,setCredentials]=useState<WebsiteLoginCredentials>({loginUrl:sourceUrl,username:'',password:''});
  useEffect(()=>{const refresh=()=>{void listWebsiteSessions(token).then(setSessions).catch(()=>setError('无法读取已保存的网站会话，请重试。'));};refresh();window.addEventListener('loomic:website-sessions-changed',refresh);return()=>window.removeEventListener('loomic:website-sessions-changed',refresh);},[token]);
  let origin='';try{origin=new URL(url).origin;}catch{}
  const remembered=sessions.find(session=>session.origin===origin);
  async function planRoute(event:FormEvent){
    event.preventDefault();setError('');
    try{
      const target=new URL(url.trim()||goal.match(/https:\/\/[^\s，。；）]+/)?.[0]||'').href;
      setPlanning(true);
      const answer=await planWebsiteJourney(token,{url:target,goal,...(plan?{previous:{goal:plannedGoal,summary:plan.summary,steps:plan.steps}}:{})});
      setUrl(target);setCredentials(value=>({...value,loginUrl:value.loginUrl||target}));setPlan(answer.plan);setPlannedGoal(goal);
      if(answer.plan.loginSuggested||/登录|会话|账号|log.?in|session/i.test(goal))setMethod(/接管|扫码|手动登录/.test(goal)?'interactive':sessions.some(session=>session.origin===new URL(target).origin)?'saved':'password');
    }catch(cause){setError(cause instanceof Error?cause.message:'请填写有效的网站地址。');}
    finally{setPlanning(false);}
  }
  async function start(){
    if(!plan)return;
    const login=method==='none'?undefined:method==='saved'&&remembered?{loginUrl:url,username:'',password:'',method:'saved' as const,savedSessionId:remembered.id}: {...credentials,loginUrl:credentials.loginUrl||url,method:method==='interactive'?'interactive' as const:'password' as const};
    await onStart(url,plan.recording==='presentation'?{style:'cursor-rebuild',durationSeconds:plan.durationSeconds,cursorCount:4}:undefined,login,{goal:plannedGoal,summary:plan.summary,steps:plan.steps,durationSeconds:plan.durationSeconds},true);
    setCredentials(value=>({...value,username:'',password:''}));
  }
  async function forget(){if(!remembered)return;try{await forgetWebsiteSession(token,remembered.id);setSessions(current=>current.filter(s=>s.id!==remembered.id));setMethod('interactive');}catch(cause){setError(cause instanceof Error?cause.message:'清除失败');}}
  return <div className="website-journey-composer">
    <div><h3 className="text-sm font-semibold">让 Agent 带你体验网站</h3><p className="mt-1 text-xs text-muted-foreground">说清要看什么，Agent 规划路线、打开页面并录制。</p></div>
    <form onSubmit={planRoute} className="space-y-3">
      <label>网站<input className="website-presentation-input" type="url" value={url} onChange={e=>{setUrl(e.target.value);setPlan(null);}} placeholder="https://example.com" /></label>
      <label>想体验什么<textarea className="website-presentation-input min-h-24 resize-y" value={goal} onChange={e=>setGoal(e.target.value)} maxLength={2000} placeholder="先看产品功能，再看定价，录一段 30 秒的介绍。需要登录时让我接管。" required /></label>
      <Button type="submit" size="sm" disabled={planning||busy}><ArrowUp className="size-4"/>{planning?'正在读取网站并规划…':plan?'按对话调整路线':'让 Agent 规划'}</Button>
    </form>
    {plan&&<section aria-label="AI 网站体验路线" className="space-y-3 rounded-lg border bg-background p-3">
      <p className="flex items-center gap-2 text-sm font-medium"><Route className="size-4"/>体验路线</p><p className="text-xs leading-5">{plan.summary}</p>
      <ol className="space-y-2">{plan.steps.map((step,index)=><li key={index} className="flex gap-2 text-xs"><span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted tabular-nums">{index+1}</span><span className="min-w-0"><strong className="font-medium">{step.title}</strong><span className="block break-all text-muted-foreground">{step.url??`在页面中寻找“${step.linkText}”`}</span></span></li>)}</ol>
      <p className="text-xs text-muted-foreground">{plan.recording==='presentation'?'多光标介绍演示':'真实浏览录屏'} · 目标 {plan.durationSeconds} 秒 · 只浏览已确认的页面</p>
      <label>登录方式<StyledSelect aria-label="登录方式" value={method} onChange={setMethod} options={[{value:'none',label:'公开页面，无需登录'},{value:'password',label:'使用账号密码，Agent 自动登录'},{value:'interactive',label:'我来扫码或手动登录'},...(remembered?[{value:'saved',label:'使用已记住的会话'}]:[])]}/></label>
      {(method==='password'||method==='interactive')&&<WebsiteLoginFields value={{...credentials,method}} onChange={setCredentials}/>}
      {method==='saved'&&remembered&&<div className="text-xs text-muted-foreground">会话保留至 {new Date(remembered.expiresAt).toLocaleString()}。<button type="button" className="ml-2 underline" onClick={forget}>忘记此网站</button></div>}
      <p className="text-xs text-muted-foreground">确认后开始录制，结果回存素材库和本次聊天。遇到验证码会主动暂停并请求你接管。</p>
      <Button size="sm" disabled={busy||planning||goal!==plannedGoal} onClick={start}>{busy?'正在启动…':'确认路线并录制'}</Button>
      {goal!==plannedGoal&&<p className="text-xs text-muted-foreground">要求已修改，请先更新路线。</p>}
    </section>}
    {error&&<p role="alert" className="text-xs text-destructive">{error}</p>}
  </div>;
}
