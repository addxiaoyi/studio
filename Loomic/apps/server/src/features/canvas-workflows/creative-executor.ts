import type { Pool } from "pg";
import { storyboardOutputSchema } from "@helstera/shared";
import type { StepExecution } from "../agent-goals/goal-step-worker.js";
import type { WorkflowAuthor } from "./author.js";
import { executeWorkflowGeneration } from "./generation.js";
import { executeLogicNode } from "./logic-executor.js";
import { readPinnedOutput } from "./pins.js";
import type { WorkflowGraph } from "@helstera/shared";

export async function executeCreativeNode(
  db: Pool,
  input: StepExecution,
  author?: WorkflowAuthor,
) {
  const command = input.step.command;
  if(command.executor==="result.pinned"){
    const run=(await db.query<{workflow_id:string;graph:WorkflowGraph}>("select workflow_id,graph from canvas_workflow_runs where goal_id=$1",[input.goal.id])).rows[0];
    const node=run?.graph.nodes.find(node=>node.id===input.step.step_id);
    if(!run||!node?.pin||node.pin.goalId!==command.sourceGoalId||node.pin.nodeId!==command.sourceNodeId)throw new Error("固定结果与当前运行不匹配。");
    return readPinnedOutput(db,node,{workflowId:run.workflow_id,workspaceId:input.goal.workspace_id,userId:input.goal.created_by});
  }
  const logic=await executeLogicNode(input);if(logic)return logic;
  if (command.executor === "content.text")
    return { text: command.text, role: command.role };
  if (command.executor === "ai.write") {
    if (!author) throw new Error("尚未配置工作流编剧模型。");
    const context = command.sources
      .map(
        (id) =>
          input.previous.find((step) => step.step_id === id)?.output?.text,
      )
      .filter((text): text is string => typeof text === "string")
      .join("\n\n");
    return author({
      workspaceId: input.goal.workspace_id,
      userId: input.goal.created_by,
      command,
      context,
      signal: input.signal,
    });
  }
  if (command.executor === "content.shot") {
    const source = input.previous.find(
      (step) => step.step_id === command.fromStep,
    )?.output;
    const storyboard = storyboardOutputSchema.parse({
      title: source?.title,
      shots: source?.shots,
    });
    const shot = storyboard.shots[command.index - 1];
    if (!shot) throw new Error(`分镜中不存在第${command.index}个镜头。`);
    return {
      ...shot,
      text: `${shot.title}\n${shot.description}\n对白：${shot.dialogue}\n时长：${shot.duration}秒`,
    };
  }
  if (command.executor === "media.generate")
    return executeWorkflowGeneration(db, input, command);
  return null;
}
