"use client";
import { studioDisplayName } from "@/lib/studio-display-name";
import { useEffect, useRef, type FormEvent, type KeyboardEvent, type MouseEvent } from "react";
import { ArrowUp, Bot, Square } from "lucide-react";
import { Button } from "./ui/button";
import { StudioChatPlan } from "./studio-chat-plan";
import { useStudioConversation } from "@/hooks/use-studio-conversation";
import type { StudioWorkflowProps } from "@/hooks/use-studio-ai-workflow";
import { useLocale } from "@/lib/i18n";
import { useVideoText } from "@/lib/video-copy";
import type { VideoStudioControl } from "@helstera/shared";
import {StudioMaterialLibrary} from "./studio-material-library";
import {StudioMaterialGeneration} from "./studio-material-generation";
import {StudioNarration} from './studio-narration';

type Props=StudioWorkflowProps & {onOpenPanel?(panel:"assets"|"transcript"|"timeline"):void;onViewTimeline?():void};
function controlLabel(control:VideoStudioControl,english:boolean){
  if(control.type==="seek")return english?`Seek to ${control.seconds}s`:`定位到 ${control.seconds} 秒`;
  if(control.type==="select")return english?`Open ${control.compositionId}`:`切换到 ${control.compositionId}`;
  if(control.type==="undo")return control.actionIndex===undefined?english?"Undo latest edit":"撤销最近修改":english?`Undo action ${control.actionIndex+1}`:`撤销动作 ${control.actionIndex+1}`;
  return ({play:english?"Play preview":"播放预览",pause:english?"Pause preview":"暂停预览",mute:english?"Change preview sound":"切换预览声音",export:english?"Open export settings":"打开导出设置",panel:english?"Open workspace panel":"打开工作区面板"})[control.type];
}
export function StudioConversationPanel(props:Props){
  const chat=useStudioConversation(props),flow=chat.flow;
  const english=useLocale()==="en-US",copy=useVideoText();
  const input=useRef<HTMLTextAreaElement>(null),scroll=useRef<HTMLDivElement>(null);
  const locked=chat.sending||chat.restoring||flow.busy||flow.restoring||flow.receiptPending;
  const visible=chat.turns.filter(turn=>turn.compositionId===flow.target?.compositionId);
  const inlinePlan=[...visible].reverse().find(turn=>turn.planId&&turn.planId===flow.plan?.approval?.id);
  const activeGeneration=[...visible].reverse().find(turn=>turn.material?.type==="generate");
  useEffect(()=>{const node=scroll.current;if(node)node.scrollTop=node.scrollHeight;},[chat.turns.length,flow.target?.compositionId,flow.plan,flow.notice,chat.error]);
  useEffect(()=>{if(props.contextRequest)input.current?.focus();},[props.contextRequest]);
  function submit(event:FormEvent){event.preventDefault();void chat.send();}
  function keyboard(event:KeyboardEvent<HTMLTextAreaElement>){
    if(event.key==="Enter"&&!event.shiftKey&&!event.nativeEvent.isComposing){event.preventDefault();if(!locked)void chat.send();}
    event.stopPropagation();
  }
  function chooseSuggestion(event:MouseEvent<HTMLButtonElement>){chat.setDraft(event.currentTarget.dataset.prompt??"");input.current?.focus();}
  const suggestions=english?["Explain the current video and suggest improvements.","Add a short opening title.","Change this video to portrait without replacing its content."]:["看看当前视频，给我剪辑建议","在开头加一条简短标题","保留画面，把视频改成竖屏"];
  return <aside aria-label={english?"Video AI conversation":"视频 AI 对话"} className="flex h-full min-h-0 w-full flex-col bg-card text-card-foreground">
    <header className="flex shrink-0 items-start justify-between gap-2 border-b px-4 py-3">
      <div><h2 className="flex items-center gap-2 text-sm font-semibold"><Bot className="size-4"/>{english?"Create with AI":"对话创作"}</h2><p title={flow.target?.compositionId} aria-label={copy("修改对象")} className="mt-1 break-all text-xs text-muted-foreground">{flow.target?`${studioDisplayName(flow.target.compositionId, english)} · ${flow.target.duration.toFixed(1)}s${flow.target.width?` · ${flow.target.width}×${flow.target.height}`:""}`:english?"Reading your project…":"正在读取工程…"}</p></div>
      <Button size="sm" variant="ghost" onClick={props.onViewTimeline}>{english?"Timeline":"时间线"}</Button>
    </header>
    <div ref={scroll} className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 py-4">
      {!visible.length&&<div className="space-y-3"><p className="text-sm leading-6">{english?"Tell me what you want to create. I can inspect this project, edit layers, cut clips, add music, control playback and prepare an export.":"告诉我你想做什么。我可以读取当前工程，修改图层、剪辑、加字幕与配乐，控制预览并准备导出。"}</p><div className="space-y-2">{suggestions.map(prompt=><button key={prompt} data-prompt={prompt} onClick={chooseSuggestion} className="block w-full rounded-lg border px-3 py-2 text-left text-xs leading-5 hover:bg-muted">{prompt}</button>)}</div></div>}
      <div role="log" aria-label={english?"Video conversation":"视频创作对话记录"} aria-live="polite" className="space-y-4">
        {visible.map(turn=><article key={turn.id} className={turn.role==="user"?"ml-5 rounded-xl bg-muted px-3 py-2":"space-y-3"}>
          <p className="mb-1 text-[11px] text-muted-foreground">{turn.role==="user"?english?"You":"你":english?"AI director":"AI 创作助手"}</p>
          <p className="select-text whitespace-pre-wrap break-words text-sm leading-6">{turn.content}</p>
          {turn===inlinePlan&&<StudioChatPlan flow={flow} locked={locked}/>}
          {turn.material?.type==="library"&&<StudioMaterialLibrary token={props.token} runtime={props.runtime} compositionId={turn.compositionId} query={turn.material.query} mediaType={turn.material.mediaType} onImported={name=>chat.materialImported(turn.compositionId,name)}/>}
          {turn===activeGeneration&&turn.material?.type==="generate"&&<StudioMaterialGeneration request={turn.material} userId={props.userId} token={props.token} runtime={props.runtime} compositionId={turn.compositionId} onImported={name=>chat.materialImported(turn.compositionId,name)}/>}
          {turn.material?.type==='narration'&&<StudioNarration request={turn.material} token={props.token} userId={props.userId} turnId={turn.id} runtime={props.runtime} compositionId={turn.compositionId} onImported={name=>chat.materialImported(turn.compositionId,name)}/>}
          {turn.planId&&turn!==inlinePlan&&<p className="text-xs text-muted-foreground">{turn.status==="applied"?english?"Applied":"已应用":turn.status==="undone"?english?"Undone":"已撤销":english?"Previous proposal":"历史方案，以当前工程为准"}</p>}
          {turn.control&&<Button size="sm" variant="outline" disabled={locked||turn.status!=="pending"} onClick={()=>void chat.executeControl(turn)}>{turn.status==="applied"?english?"Completed":"已完成":turn.status==="failed"?english?"Failed — send again":"操作失败，请重新发送":turn.status==="superseded"?english?"Previous action":"历史操作":controlLabel(turn.control,english)}</Button>}
        </article>)}
      </div>
      {!inlinePlan&&<StudioChatPlan flow={flow} locked={locked}/>}
      {(flow.notice||chat.sending)&&<p role="status" className="text-xs leading-5 text-muted-foreground">{chat.sending?`${chat.stage} · ${chat.elapsed}s · ${english?"You can stop waiting; edits require confirmation.":"可以停止等待，修改仍需确认。"}`:copy(flow.notice)}</p>}
      {(chat.error||flow.error)&&<p role="alert" className="rounded-lg border border-destructive/30 p-3 text-sm leading-5 text-destructive">{chat.error||flow.error}</p>}
    </div>
    <form onSubmit={submit} className="shrink-0 space-y-2 border-t bg-card p-3">
      {flow.context&&<div className="flex items-center justify-between gap-2 text-xs text-muted-foreground"><span className="truncate">{english?"Selected: ":"已引用选中内容："}{flow.context.label}</span><button type="button" onClick={flow.removeContext} className="shrink-0 underline">{copy("移除")}</button></div>}
      <label htmlFor="video-chat-input" className="sr-only">{english?"Message video AI":"与视频 AI 对话"}</label>
      <textarea ref={input} id="video-chat-input" aria-label={english?"Message video AI":"与视频 AI 对话"} value={chat.draft} onChange={event=>chat.setDraft(event.target.value)} onKeyDown={keyboard} placeholder={english?"Describe your goal, or keep refining…":"说出创作目标，或继续修改刚才的方案…"} rows={3} maxLength={4000} disabled={chat.restoring||!props.runtime} className="w-full resize-none rounded-xl border bg-background p-3 text-base leading-6 sm:text-sm"/>
      <div className="flex items-center justify-between gap-2"><p className="text-[11px] leading-4 text-muted-foreground">{english?"Changes need confirmation · Shift+Enter for a new line":"修改前确认 · Shift+Enter 换行"}</p>{chat.sending?<Button type="button" size="sm" variant="outline" onClick={chat.stop}><Square className="size-3"/>{english?"Stop":"停止"}</Button>:<Button type="submit" size="sm" disabled={locked||!props.runtime||!chat.draft.trim()}><ArrowUp className="size-4"/>{english?"Send":"发送"}</Button>}</div>
    </form>
  </aside>;
}
