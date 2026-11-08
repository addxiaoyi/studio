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
        plan: async (_workspace, input) => {
          const graph = websiteWorkflow();
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
