"use client";
import { Input } from "@/components/ui/input";

export function validWorkflowBudget(value: string) {
  return value.trim() !== "" && /^\d+(?:\.\d{1,4})?$/.test(value) && Number(value) <= 100000;
}
export function WorkflowBudgetField({value, onChange, disabled=false}:{value:string;onChange(value:string):void;disabled?:boolean}) {
  return <label className="block space-y-2 rounded-xl border border-border bg-muted/30 p-3 text-sm">
    <span className="font-medium">本次流程预算上限（积分）</span>
    <Input type="number" min="0" max="100000" step="0.0001" value={value} onChange={event=>onChange(event.target.value)} disabled={disabled} aria-invalid={!validWorkflowBudget(value)} />
    <span className="block text-xs leading-5 text-muted-foreground">0 表示不允许付费生成。所有节点累计确认的费用不得超过上限，每个生成节点仍需单独确认。重试共用本次额度；退款不会自动增加本次可确认额度。</span>
  </label>;
}
