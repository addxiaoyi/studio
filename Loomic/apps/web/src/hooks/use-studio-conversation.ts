"use client";
import { useEffect, useRef, useState } from "react";
import type { StudioWorkflowProps } from "./use-studio-ai-workflow";
import { useStudioAiWorkflow } from "./use-studio-ai-workflow";
import { chatHistory, requestStudioChat, type StudioChatTurn, type StudioConversation } from "@/lib/studio-chat";
import { readStudioChat, saveStudioChat } from "@/lib/visualforge-storage";
import { normalizeModelPlan } from "@/lib/studio-ai-edit";
import { studioVideoDuration } from "@/lib/studio-video-metadata";
import { useLocale } from "@/lib/i18n";
import type { VideoChatRequest } from "@helstera/shared";
import { studioDirectControl } from "@/lib/studio-direct-control";

export function useStudioConversation(props:StudioWorkflowProps & {onOpenPanel?(panel:"assets"|"transcript"|"timeline"):void}) {
  const {onBusyChange:_busyChange,...workflowProps}=props;
  const flow=useStudioAiWorkflow(workflowProps);
  const locale=useLocale();
  const [turns,setTurns]=useState<StudioChatTurn[]>([]),[draft,setDraft]=useState("");
  const [sending,setSending]=useState(false),[restoring,setRestoring]=useState(true),[error,setError]=useState("");
  const controller=useRef<AbortController|null>(null);
  const mounted=useRef(true),history=useRef(turns);history.current=turns;
  const saving=useRef(Promise.resolve<unknown>(undefined));
  const loaded=useRef(false);
  const acting=useRef(false);
  function updateTurns(update:(current:StudioChatTurn[])=>StudioChatTurn[]) {
    const next=update(history.current);if(next===history.current)return;
    history.current=next;setTurns(next);
  }
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;controller.current?.abort();};},[]);
  useEffect(()=>{
    let alive=true;loaded.current=false;setRestoring(true);
    void readStudioChat<StudioConversation>(props.userId).then(saved=>{if(alive){updateTurns(()=>saved?.turns??[]);setDraft(saved?.draft??"");loaded.current=true;}}).catch(()=>{if(alive)setError("无法读取本机对话记录，请刷新后重试。");}).finally(()=>{if(alive)setRestoring(false);});
    return()=>{alive=false;};
  },[props.userId]);
  useEffect(()=>{
    if(!loaded.current)return;
    saving.current=saving.current.then(()=>saveStudioChat(props.userId,{turns,draft})).catch(cause=>{if(mounted.current)setError(`对话保存失败：${cause instanceof Error?cause.message:"请检查本机存储"}`);});
  },[turns,draft,props.userId]);
  useEffect(()=>{props.onBusyChange?.(sending||flow.busy||flow.receiptPending);},[sending,flow.busy,flow.receiptPending,props.onBusyChange]);
  useEffect(()=>{
    if(!flow.plan?.approval?.id||!flow.applied)return;
    const id=flow.plan.approval.id,status=flow.completelyUndone?"undone":"applied";
    updateTurns(current=>current.some(turn=>turn.planId===id&&turn.status!==status)?current.map(turn=>turn.planId===id?{...turn,status}:turn):current);
  },[flow.plan?.approval?.id,flow.applied,flow.completelyUndone]);

  function append(turn:Omit<StudioChatTurn,"id"|"createdAt">) {
    const next={...turn,id:crypto.randomUUID(),createdAt:Date.now()};
    updateTurns(current=>[...current,next].slice(-100));return next;
  }
  async function send() {
    if(!props.runtime||!draft.trim()||controller.current||flow.busy||flow.receiptPending||restoring||flow.restoring)return;
    const runtime=props.runtime,prompt=draft.trim(),abort=new AbortController();controller.current=abort;
    setSending(true);setError("");
    let compositionId=runtime.projectId();
    try {
      if(/^(确认全部并执行|confirm all and apply)[。.!！]?$/i.test(prompt)){
        append({role:"user",content:prompt,compositionId});setDraft("");
        if(!flow.plan||flow.applied)throw new Error("当前没有待确认方案，请先描述你想修改的内容。");
        await flow.confirmAllAndApply();
        const checked=await runtime.snapshot();
        if(!checked.appliedEdits?.includes(flow.plan.approval!.id)&&flow.plan.actions.some(action=>action.type!=="export"))throw new Error("方案尚未成功应用，请查看审批或工程提示。");
        append({role:"assistant",content:"已按你明确确认的方案修改当前视频。可以继续对话调整或导出。",compositionId});return;
      }
      const snapshot=await runtime.snapshot();compositionId=snapshot.compositionId;
      const direct=studioDirectControl(prompt);
      if(direct){
        if(direct.type==="undo"&&!flow.actionUndoAvailable)throw new Error("最近修改已无法自动撤销，请查看当前方案状态。");
        append({role:"user",content:prompt,compositionId});setDraft("");
        const turn=append({role:"assistant",content:locale==="en-US"?"Executing your editor command.":"正在执行你的编辑器指令。",compositionId,control:direct,revision:snapshot.revision,status:"pending"});
        await executeControl(turn,true);return;
      }
      const studio=await runtime.studioState();
      const undoable=flow.plan&&flow.actionUndoAvailable?flow.plan.actions.flatMap((action,index)=>action.type!=="export"&&!flow.undoneActions.includes(index)?[index]:[]):[];
      studio.undoable=undoable;if(undoable.length)studio.controls.push("undo");
      if(flow.context?.compositionId===compositionId)studio.selection=[studio.selection,flow.context.context,flow.context.comment].filter(Boolean).join("\n").slice(0,2000);
      const media:VideoChatRequest["media"]=[];
      for(const item of runtime.listMedia())media.push({name:item.name,mimeType:item.mimeType as VideoChatRequest["media"][number]["mimeType"],duration:await studioVideoDuration(await runtime.readMedia(item.name))});
      abort.signal.throwIfAborted();
      const previous=chatHistory(history.current,compositionId,flow.plan,flow.applied,flow.undoneActions);
      append({role:"user",content:prompt,compositionId});setDraft("");
      const response=await requestStudioChat(props.token,{prompt,projectId:runtime.projectId(),compositionId,revision:snapshot.revision,compositionDuration:snapshot.duration,layers:snapshot.layers??[],media,history:previous,studio,locale,...(flow.plan&&!flow.applied?{pendingPlan:flow.plan.commands}:{})},abort.signal);
      abort.signal.throwIfAborted();
      const current=await runtime.snapshot();
      if(current.compositionId!==compositionId||current.revision!==snapshot.revision)throw new Error("对话期间工程已改变，本次操作未执行，请重新发送。");
      const answer=response.reply;
      if(answer.plan){
        if(!response.approval)throw new Error("方案缺少审批记录，未执行修改。");
        await flow.acceptPlan({...normalizeModelPlan(answer.plan,snapshot),approval:response.approval,mediaDurations:Object.fromEntries(media.map(item=>[item.name,item.duration]))});
        updateTurns(current=>current.map(turn=>turn.status==="pending"?{...turn,status:"superseded"}:turn));
        append({role:"assistant",content:answer.message,compositionId,planId:response.approval.id,status:"pending"});
      }else if(answer.control){
        const turn=append({role:"assistant",content:answer.message,compositionId,control:answer.control,revision:snapshot.revision,status:"pending"});
        if(["play","pause","seek","mute","select"].includes(answer.control.type))await executeControl(turn,true);
      }else append({role:"assistant",content:answer.message,compositionId});
    }catch(cause){
      if(!mounted.current)return;
      const message=abort.signal.aborted?"已停止等待回复，没有执行修改。":cause instanceof Error?cause.message:"AI 暂时不可用，请重试。";
      setError(message);append({role:"assistant",content:message,compositionId,status:"failed"});setDraft(current=>current||prompt);
    }finally{if(controller.current===abort)controller.current=null;if(mounted.current)setSending(false);}
  }
  function stop(){controller.current?.abort();}
  async function executeControl(turn:StudioChatTurn,fromReply=false){
    if(!turn.control||!props.runtime||turn.status!=="pending"||acting.current||sending&&!fromReply||flow.busy||flow.receiptPending)return;
    acting.current=true;
    setSending(true);setError("");
    try {
      const snapshot=await props.runtime.snapshot();
      if(snapshot.compositionId!==turn.compositionId||snapshot.revision!==turn.revision)throw new Error("当前视频已改变，请重新发送此操作。");
      // Consume the UI action before dispatch. A refresh cannot replay an uncertain action.
      const consumed=history.current.map(item=>item.id===turn.id?{...item,status:"superseded" as const}:item);
      await saving.current;await saveStudioChat(props.userId,{turns:consumed,draft});updateTurns(()=>consumed);
      const command=turn.control;
      let content:string;
      if(command.type==="undo"){
        if(command.actionIndex===undefined)await flow.undoPlan();else await flow.undoAppliedAction(command.actionIndex);
        const after=await props.runtime.snapshot();
        if(after.revision===snapshot.revision)throw new Error("撤销未完成，请查看方案中的原因。");
        content="撤销已完成，当前工程已更新。";
      }else if(command.type==="export"){props.runtime.openExport();content="已打开当前版本的导出设置，请确认格式和文件名。";}
      else if(command.type==="panel"){
        if(!props.onOpenPanel)throw new Error("该工作区面板暂不可用。");props.onOpenPanel(command.panel);content="已打开对应工作区，请继续选择素材或确认处理。";
      }else content=await props.runtime.control(command,turn.compositionId);
      updateTurns(current=>current.map(item=>item.id===turn.id?{...item,status:"applied"}:item));
      append({role:"assistant",content,compositionId:props.runtime.projectId()});await flow.refreshTarget();
    }catch(cause){setError(cause instanceof Error?cause.message:"操作失败，请核对当前视频后重试。");updateTurns(current=>current.map(item=>item.id===turn.id?{...item,status:"failed"}:item));}
    finally{acting.current=false;setSending(false);}
  }
  return {flow,turns,draft,setDraft,sending,restoring,error,send,stop,executeControl};
}
