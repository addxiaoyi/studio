import type { WorkflowGraph, WorkflowNode } from "@helstera/shared";
import {workflowFieldNames,formatWorkflowValue} from "./config-values";
function fields(node: WorkflowNode): Record<string, unknown> {
  return {
    title: node.title,
    ...node.config,
    note: node.note,
    position: node.position,
    pin: node.pin,
  };
}
export function WorkflowVersionValues({
  before,
  after,
}: { before: WorkflowGraph; after: WorkflowGraph }) {
  return (
    <div className="workflow-version-values">
      {after.nodes.map((node) => {
        const prior = before.nodes.find((item) => item.id === node.id);
        if (!prior) return null;
        const left = fields(prior);
        const right = fields(node);
        const keys = [
            ...new Set([...Object.keys(left), ...Object.keys(right)]),
          ].filter(
            (key) => JSON.stringify(left[key]) !== JSON.stringify(right[key]),
          );
        if (!keys.length) return null;
        return (
          <details key={node.id}>
            <summary>{node.title} · 参数前后值</summary>
            <dl>
              {keys.map((key) => (
                <div key={key}>
                  <dt>{workflowFieldNames[key] ?? key}</dt>
                  <dd>
                    <span>当前</span>
                      {formatWorkflowValue(left[key],key)}
                  </dd>
                  <dd>
                    <span>恢复后</span>
                      {formatWorkflowValue(right[key],key)}
                  </dd>
                </div>
              ))}
            </dl>
          </details>
        );
      })}
    </div>
  );
}
