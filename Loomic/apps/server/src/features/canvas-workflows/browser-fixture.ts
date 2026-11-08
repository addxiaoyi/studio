import { readFile } from "node:fs/promises";
import { createPresentationFixture } from "../website-capture/presentation-fixture.js";
import { registerCanvasWorkflowRoutes } from "../../http/canvas-workflows.js";
import { registerAgentGoalRoutes } from "../../http/agent-goals.js";
import { GoalStepWorker } from "../agent-goals/goal-step-worker.js";
import { createGoalStepExecutor } from "../agent-goals/goal-step-executors.js";
import { executableGoalPlan } from "../agent-goals/goal-planner.js";
import { compileWorkflow, websiteWorkflow } from "@helstera/shared";
import {
  persistCaptureAsset,
  buildWebsiteIntroduction,
} from "../website-capture/isolated-browser.js";
import { guardWorkflowExecution } from "./execution-access.js";

export async function createWorkflowFixture(database: string, origin: string) {
  let worker: GoalStepWorker | undefined;
  const fixture = await createPresentationFixture(
    database,
    origin,
    async (ctx) => {
      for (const migration of [
        "20261022000000_desktop_agent_tasks",
        "20261023000000_desktop_agent_approvals",
        "20261023000002_desktop_agent_canvas_link",
        "20261030000000_agent_goals",
        "20261030000001_agent_goal_retry",
        "20261030000002_agent_goal_background",
        "20261031000000_agent_muse_workspace",
        "20261106000003_goal_execution_steps",
        "20261108000004_canvas_workflows",
        "20261108000005_creative_library",
        "20261108000006_workflow_assistant",
        "20261109000000_workflow_partial_runs",
      ])
        await ctx.db.query(
          await readFile(
            new URL(
              `../../local-db/migrations/${migration}.sql`,
              import.meta.url,
            ),
            "utf8",
          ),
        );
      registerCanvasWorkflowRoutes(ctx.app, {
        ...ctx,
        env: {} as never,
        settingsService: {} as never,
        enabled: () => true,
        assistantPlan:async(prompt,context)=>{
          const input=context as {workflow?:{graph:import("@helstera/shared").WorkflowGraph};references?:Array<{text?:string}>};
          if(prompt.includes("仅规划引用验收")&&!input.references?.some(item=>item.text?.includes("Inspire reference")))throw new Error("没有收到用户指定的真实选区引用");
          if(prompt==="暂停当前流程")return {action:"pause",summary:"暂停当前运行"};
          if(prompt==="继续当前流程")return {action:"resume",summary:"继续未完成步骤"};
          if(prompt==="运行当前流程")return {action:"run",summary:"检查并运行已保存版本"};
          const graph=input.workflow?.graph?structuredClone(input.workflow.graph):websiteWorkflow();
          if(graph.nodes[0]!.config.kind==="url")graph.nodes[0]!.config={kind:"url",url:"https://example.com/"};
          graph.title=prompt.includes("仅规划引用验收")?"引用验收方案":"AI 网站研究";
          if(prompt.includes("录制")){const capture=graph.nodes.find(node=>node.config.kind==="capture");if(capture?.config.kind==="capture")capture.config.record=true;}
          return {action:"edit",summary:"已准备节点方案，确认后应用。",graph};
        },
        plan: async (_workspace, input, referenceContext) => {
          const graph = websiteWorkflow();
          if(input.goal.includes("仅规划引用验收")){
            const references=(referenceContext as {references?:Array<{text?:string}>})?.references;
            if(!references?.some(item=>item.text?.includes("Inspire reference")))throw new Error("没有收到用户指定的真实选区引用");
            graph.title="引用验收方案";
          }
          graph.nodes[0]!.config = { kind: "url", url: "https://example.com/" };
          return executableGoalPlan(compileWorkflow(graph), input);
        },
      });
      registerAgentGoalRoutes(ctx.app, { ...ctx, assistantHub: {} as never });
      const execute = createGoalStepExecutor({
        db: ctx.db,
        storage: ctx.storage,
        storageRoot: ctx.root,
        webOrigin: origin,
        desktop: {} as never,
        author: async ({command,context}) => {
          if (!context.includes("机器人寻找花园")) throw new Error("创作输入未通过连线到达编剧节点");
          return {title:"机器人的花园",text:"# 机器人的花园\n\n机器人穿过城市，找到屋顶花园。",shots:Array.from({length:command.shotCount},(_,index)=>({title:`场景 ${index+1}`,description:`机器人寻找花园，镜头 ${index+1}`,dialogue:"出发吧。",duration:5}))};
        },
      });
      worker = new GoalStepWorker(
        ctx.db,
        guardWorkflowExecution(ctx.db, async (input) => {
          if (input.step.command.executor !== "web.capture")
            return execute(input);
          await input.assertActive();
          const task = {
            id: input.step.id,
            workspace_id: ctx.workspaceId,
            created_by: ctx.userId,
            start_url: "https://example.com/",
            page_limit: 1,
            record_video: false,
            follow_external: false,
          };
          await ctx.db.query(
            "insert into website_capture_tasks(id,workspace_id,created_by,mode,start_url,idempotency_key,status) values($1,$2,$3,'isolated',$4,$5,'running')",
            [task.id, ctx.workspaceId, ctx.userId, task.start_url, task.id],
          );
          const page = await ctx.browser.newPage({
            viewport: { width: 1280, height: 720 },
          });
          try {
            await page.setContent(
              '<title>Workflow test</title><main style="font:30px system-ui;padding:80px"><h1>可视化工作流验收</h1><p>由真实浏览器生成截图</p></main>',
            );
            const image = await persistCaptureAsset({
              db: ctx.db,
              storage: ctx.storage,
              storageRoot: ctx.root,
              webOrigin: origin,
              task,
              bytes: await page.screenshot({ type: "jpeg" }),
              mimeType: "image/jpeg",
              mediaType: "image",
              title: "工作流截图",
              metadata: {},
            });
            const pages = [
              {
                url: task.start_url,
                title: "可视化工作流验收",
                description: "真实浏览器截图",
                headings: ["工作流"],
                navigation: [],
                assetId: image.id,
                screenshotUrl: image.url,
              },
            ];
            const output = {
              title: "可视化工作流验收",
              startUrl: task.start_url,
              introduction: buildWebsiteIntroduction(task.start_url, pages),
              pages,
              evidence: [],
              claims: [],
              completedAt: new Date().toISOString(),
            };
            await ctx.db.query(
              "update website_capture_tasks set status='succeeded',result=$2::jsonb where id=$1",
              [task.id, JSON.stringify(output)],
            );
            return output;
          } finally {
            await page.close();
          }
        }),
      );
      worker.start();
    },
  );
  return {
    ...fixture,
    close: async () => {
      worker?.stop();
      await fixture.close();
    },
  };
}
