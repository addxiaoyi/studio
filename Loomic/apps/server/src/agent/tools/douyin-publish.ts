import type { Pool } from "pg";
import { tool } from "langchain";
import { z } from "zod";

const inputSchema = z.object({
  package_id: z.string().uuid().describe("Feed content package id"),
  platform: z.literal("douyin").default("douyin"),
});

export function createDouyinPublishDraftTool(deps: { localDb?: Pool; webOrigin: string }) {
  return tool(
    async (input, config) => {
      const db = deps.localDb;
      const userId = (config as any)?.configurable?.user_id as string | undefined;
      if (!db || !userId) return { status: "unavailable", message: "发布草稿需要已登录的本地工作区。" };
      const { rows } = await db.query(
        `select cp.id,cp.title,cp.status,cp.platforms,cv.title as variant_title,cv.body,cv.hashtags,cv.cover_text
         from content_packages cp
         join content_variants cv on cv.package_id=cp.id and cv.platform='douyin'
         join workspace_members wm on wm.workspace_id=cp.workspace_id and wm.user_id=$2
         where cp.id=$1 and cp.status in ('ready','exported','scheduled','published','measured','analyzed')
         order by cv.version desc limit 1`,
        [input.package_id, userId],
      );
      const packageRow = rows[0];
      if (!packageRow) return { status: "not_ready", message: "内容包不存在、未批准或尚未完成媒体生成。" };
      return {
        status: "approval_required",
        approvalRequired: true,
        manualOnly: true,
        packageId: packageRow.id,
        platform: "douyin",
        title: packageRow.variant_title ?? packageRow.title,
        body: packageRow.body,
        hashtags: packageRow.hashtags ?? [],
        coverText: packageRow.cover_text ?? "",
        handoffUrl: `${deps.webOrigin}/feed?packageId=${encodeURIComponent(packageRow.id)}&step=5`,
        instructions: "打开发布审批页后，用户需要接管抖音登录并在最终发布按钮前确认。Agent 不会输入密码或点击最终发布。",
      };
    },
    {
      name: "prepare_douyin_publish",
      description: "Prepare an approved Douyin content package for human-confirmed publishing. Never logs in or publishes automatically.",
      schema: inputSchema,
    },
  );
}
