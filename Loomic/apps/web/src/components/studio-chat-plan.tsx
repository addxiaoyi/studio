"use client";
import type { useStudioAiWorkflow } from "@/hooks/use-studio-ai-workflow";
import { studioActionLabel } from "@/lib/studio-action-label";
import { useVideoText } from "@/lib/video-copy";
import { useLocale } from "@/lib/i18n";
import { Button } from "./ui/button";
import { StudioTimelineDiff } from "./studio-timeline-diff";

export function StudioChatPlan({flow,locked}:{flow:ReturnType<typeof useStudioAiWorkflow>;locked:boolean}) {
  const copy=useVideoText(),english=useLocale()==="en-US";
  if(!flow.plan)return null;
  return <section data-testid="studio-ai-plan" className="space-y-3 rounded-xl border bg-background p-3">
    <h3 className="text-sm font-semibold">{copy(flow.completelyUndone?"本次修改已全部撤销":flow.applied?"修改已应用":"确认这些修改")}</h3>
    <p className="text-xs leading-5 text-muted-foreground">{flow.plan.summary}</p>
    <StudioTimelineDiff plan={flow.plan} undone={flow.undoneActions} applied={Boolean(flow.applied)}/>
    <ol className="space-y-3">{flow.plan.actions.map((action,index)=>{
      const undone=flow.undoneActions.includes(index),command=flow.plan?.commands?.actions[index];
      return <li key={index} data-action-index={index} className="space-y-1 text-xs leading-5">
        <label className="flex items-start gap-2"><input type="checkbox" className="mt-1" checked={flow.confirmed.has(index)} disabled={locked||Boolean(flow.applied)} onChange={event=>flow.toggleAction(index,event.target.checked)}/><span className={undone?"line-through text-muted-foreground":""}>{command?studioActionLabel(command,flow.plan!.snapshot,english):action.label}</span></label>
        {undone?<p className="pl-5 text-muted-foreground">{copy("已撤销")}</p>:flow.applied&&flow.actionUndoAvailable&&action.type!=="export"?<button type="button" disabled={locked} aria-label={`${copy("撤销动作")} ${index+1}`} onClick={()=>void flow.undoAppliedAction(index)} className="ml-5 min-h-7 rounded border px-2 hover:bg-muted">{english?"Undo this action":"撤销此动作"}</button>:null}
      </li>;
    })}</ol>
    {!flow.applied?<>
      <p className="text-xs leading-5 text-muted-foreground">{copy("已确认")} {flow.confirmed.size}/{flow.plan.actions.length} · {english?'Reply to revise, or say “confirm all and apply”.':'可继续修改方案，或发送“确认全部并执行”。'}</p>
      <Button className="w-full" disabled={locked||flow.confirmed.size!==flow.plan.actions.length} onClick={flow.applyPlan}>{copy("确认并应用修改")}</Button>
      <Button className="w-full" variant="ghost" disabled={locked} onClick={flow.discardPlan}>{english?"Discard proposal":"放弃方案"}</Button>
    </>:<>
      <Button className="w-full" disabled={locked} onClick={flow.exportVideo}>{copy(flow.undoneActions.length?"导出当前版本":"导出视频")}</Button>
      {flow.canUndo&&<Button className="w-full" variant="ghost" disabled={locked} onClick={flow.undoPlan}>{copy("撤销本次修改")}</Button>}
    </>}
    {flow.receiptPending&&<Button className="w-full" variant="outline" disabled={flow.busy} onClick={flow.retryReceipt}>{copy("重试同步记录")}</Button>}
  </section>;
}
