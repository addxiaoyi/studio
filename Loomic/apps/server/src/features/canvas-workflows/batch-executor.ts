import { createHash } from "node:crypto";
import { readWorkflowField, type GoalCommand } from "@helstera/shared";
import {
  StepWaiting,
  type StepExecution,
} from "../agent-goals/goal-step-worker.js";

const MAX_OUTPUT = 24000;
function printable(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (text === undefined || text.length > MAX_OUTPUT)
    throw new Error("批量结果超过 24000 字，请减少输入。");
  return text;
}
function bounded(items: unknown[]) {
  printable(items);
  return { items, json: items, text: items.map(printable).join("\n") };
}
const digest = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
function runItem(
  item: unknown,
  index: number,
  operations: Extract<GoalCommand, { executor: "flow.batch" }>["operations"],
) {
  let value = item;
  for (const op of operations) {
    if (op.kind === "extract") {
      value = readWorkflowField(value, op.path);
      if (value === undefined)
        throw new Error(`第 ${index + 1} 项缺少字段“${op.path}”。`);
    } else if (op.kind === "template") {
      const text = printable(value);
      const count = op.template.split("{{text}}").length - 1;
      if (op.template.length + count * text.length > MAX_OUTPUT)
        throw new Error("批量模板结果过长。");
      value = op.template.replace(/\{\{(text|index)\}\}/g, (_, key) =>
        key === "text" ? text : String(index + 1),
      );
    } else {
      const text = printable(value);
      if (op.operation === "replace") {
        if (!op.search) throw new Error("批量替换需要填写查找文字。");
        const parts = text.split(op.search);
        if (
          text.length +
            (parts.length - 1) * (op.replacement.length - op.search.length) >
          MAX_OUTPUT
        )
          throw new Error("批量替换结果过长。");
        value = parts.join(op.replacement);
      } else
        value =
          op.operation === "trim"
            ? text.trim()
            : op.operation === "uppercase"
              ? text.toUpperCase()
              : text.toLowerCase();
    }
    printable(value);
  }
  return value;
}
export async function executeBatchNode(
  input: StepExecution,
  source: Record<string, unknown>,
) {
  const command = input.step.command;
  if (command.executor === "data.split") {
    const list =
      command.source === "lines"
        ? typeof source.text === "string"
          ? source.text
              .split(command.separator)
              .filter((line) => line.trim().length)
          : undefined
        : command.path
          ? readWorkflowField(source.json, command.path)
          : source.json;
    if (!Array.isArray(list))
      throw new Error("拆分需要文字或指定路径下的 JSON 列表。");
    if (list.length > command.maxItems)
      throw new Error(
        `列表共 ${list.length} 项，超过 ${command.maxItems} 项上限；请先缩小输入。`,
      );
    return { ...bounded(list), total: list.length };
  }
  if (command.executor !== "flow.batch") return null;
  const items = source.items;
  if (!Array.isArray(items)) throw new Error("批量循环需要连接列表拆分节点。");
  if (items.length > command.maxItems)
    throw new Error(`批量输入超过 ${command.maxItems} 项上限，尚未处理。`);
  printable(items);
  const inputHash = digest({ items, command });
  const checkpoint = input.step.output;
  const processed = checkpoint?.processed ?? 0;
  if (
    !Number.isInteger(processed) ||
    Number(processed) < 0 ||
    Number(processed) > items.length ||
    (checkpoint &&
      (checkpoint.inputHash !== inputHash ||
        !Array.isArray(checkpoint.items) ||
        checkpoint.items.length !== processed ||
        checkpoint.receiptHash !== digest(checkpoint.items)))
  )
    throw new Error("批量恢复回执不匹配或输入已变化，请重新运行。");
  const output = checkpoint ? [...(checkpoint.items as unknown[])] : [];
  const end = Math.min(items.length, Number(processed) + command.batchSize);
  for (let index = Number(processed); index < end; index++) {
    await input.assertActive();
    output.push(runItem(items[index], index, command.operations));
    printable(output);
  }
  const receipt = {
    ...bounded(output),
    inputHash,
    receiptHash: digest(output),
    processed: end,
    total: items.length,
    batches: Math.ceil(end / command.batchSize),
  };
  if (end < items.length)
    throw new StepWaiting({ ...receipt, resumeAt: new Date().toISOString() });
  return receipt;
}
