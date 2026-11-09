import { evaluateWorkflowCondition, readWorkflowField } from "@helstera/shared";
import {
  StepWaiting,
  type StepExecution,
} from "../agent-goals/goal-step-worker.js";
import { activeStepInputs } from "../agent-goals/step-routing.js";

const MAX_TEXT = 24000;
export async function executeLogicNode(
  input: StepExecution,
): Promise<Record<string, unknown> | null> {
  const c = input.step.command;
  const read = (id: string) => {
    const output = input.previous.find((step) => step.step_id === id)?.output;
    if (!output || output.skipped === true)
      throw new Error("输入节点缺少成功回执。");
    return output;
  };
  const text = (id: string) => {
    const value = read(id).text;
    if (typeof value !== "string") throw new Error("这个节点需要文字输入。");
    return value;
  };
  const bounded = (value: string) => {
    if (value.length > MAX_TEXT)
      throw new Error("处理结果超过 24000 字，请减少输入。");
    return { text: value };
  };
  const replace=(source:string,search:string,replacement:string)=>{
    const parts=source.split(search),size=source.length+(parts.length-1)*(replacement.length-search.length);
    if(size>MAX_TEXT)throw new Error("处理结果超过 24000 字，请减少输入。");
    return parts.join(replacement);
  };
  if (c.executor === "data.json") {
    const value = JSON.parse(c.json);
    if (value === null || typeof value !== "object")
      throw new Error("JSON 数据必须是对象或数组。");
    return { json: value, text: JSON.stringify(value, null, 2) };
  }
  if (c.executor === "flow.if") {
    const source = read(c.fromStep),
      matches = c.conditions.map((rule) =>
        evaluateWorkflowCondition(source, rule),
      );
    return {
      ...source,
      condition:
        c.match === "all" ? matches.every(Boolean) : matches.some(Boolean),
    };
  }
  if (c.executor === "text.transform") {
    const source = text(c.fromStep);
    if (c.operation === "replace" && !c.search)
      throw new Error("替换文本不能为空。");
    return bounded(
      c.operation === "trim"
        ? source.trim()
        : c.operation === "uppercase"
          ? source.toUpperCase()
          : c.operation === "lowercase"
            ? source.toLowerCase()
            : replace(source,c.search,c.replacement),
    );
  }
  if (c.executor === "text.template")
    return bounded(replace(c.template,"{{text}}",text(c.fromStep)));
  if (c.executor === "text.merge") {
    const sources = activeStepInputs(
      input.goal.plan,
      input.step.step_id,
      input.previous,
      c.sources,
    );
    return bounded(
      sources
        .map((source) => {
          if (typeof source.output?.text !== "string")
            throw new Error("合并节点收到非文字输入。");
          return source.output.text;
        })
        .join(c.separator),
    );
  }
  if (c.executor === "data.extract") {
    const value = readWorkflowField(read(c.fromStep).json, c.path);
    if (value === undefined) throw new Error(`输入中找不到字段“${c.path}”。`);
    return {
      ...bounded(typeof value === "string" ? value : JSON.stringify(value)),
      json: value,
    };
  }
  if (c.executor === "flow.delay") {
    const resumeAt =
      typeof input.step.output?.resumeAt === "string"
        ? Date.parse(input.step.output.resumeAt)
        : Date.now() + c.seconds * 1000;
    if (!Number.isFinite(resumeAt)) throw new Error("等待节点的恢复时间无效。");
    if (Date.now() < resumeAt)
      throw new StepWaiting({
        resumeAt: new Date(resumeAt).toISOString(),
        waitSeconds: c.seconds,
      });
    return { ...read(c.fromStep), waitedSeconds: c.seconds };
  }
  return null;
}
