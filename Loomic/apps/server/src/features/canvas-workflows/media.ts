import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Pool } from "pg";
import type { StorageProvider } from "../../storage/storage-provider.js";
import type { StepExecution } from "../agent-goals/goal-step-worker.js";
import { runOneTake } from "../onetake/runner.js";
import { savePrivateImage, savePrivateVideo } from "../assets/private-video.js";

export async function executeWorkflowMedia(
  options: { db: Pool; storage: StorageProvider; storageRoot: string },
  input: StepExecution,
) {
  const command = input.step.command;
  if (
    command.executor !== "media.compose" &&
    command.executor !== "media.frame"
  )
    return null;
  if (input.step.approval !== "consumed")
    throw new Error("合成与抽帧尚未确认。");
  const sources =
    command.executor === "media.compose" ? command.sources : [command.fromStep];
  const folderRoot = join(options.storageRoot, "workflow-media");
  await mkdir(folderRoot, { recursive: true });
  const folder = await mkdtemp(join(folderRoot, "render-"));
  try {
    const paths: string[] = [];
    for (const [index, id] of sources.entries()) {
      await input.assertActive();
      const assetId = input.previous.find((step) => step.step_id === id)?.output
        ?.recordingAssetId;
      if (typeof assetId !== "string")
        throw new Error("上游镜头缺少真实视频素材。");
      const asset = (
        await options.db.query(
          "select ao.bucket,ao.object_path from asset_objects ao left join generated_assets ga on ga.workspace_id=ao.workspace_id and ga.object_path=ao.object_path where ao.id=$1 and ao.workspace_id=$2 and ao.created_by=$3 and ao.mime_type like 'video/%' and (ga.id is null or (ga.deleted_at is null and ga.retention_state='active' and ga.retention_until>now()))",
          [assetId, input.goal.workspace_id, input.goal.created_by],
        )
      ).rows[0];
      if (!asset) throw new Error("镜头素材已失效或不可访问。");
      const media = await options.storage.download(
        asset.bucket,
        asset.object_path,
      );
      if (media.error || !media.data || media.data.length > 250 * 1024 * 1024)
        throw new Error("无法读取镜头素材或素材过大。");
      const path = join(folder, `clip-${index}.mp4`);
      await writeFile(path, media.data);
      paths.push(path);
    }
    const frame = command.executor === "media.frame",
      output = join(folder, frame ? "frame.png" : "output.mp4");
    const info = (await runOneTake(
      frame
        ? { operation: "frame", source: paths[0], output, at: command.at }
        : {
            operation: "compose",
            sources: paths,
            output,
            aspect: command.aspect,
          },
      input.signal,
    )) as Record<string, unknown>;
    await input.assertActive();
    const upload = {
      workspaceId: input.goal.workspace_id,
      userId: input.goal.created_by,
      uploadId: input.step.id,
      bytes: await readFile(output),
    };
    const asset = frame
      ? await savePrivateImage(options.db, options.storage, {
          ...upload,
          mimeType: "image/png",
        })
      : await savePrivateVideo(options.db, options.storage, {
          ...upload,
          mimeType: "video/mp4",
          filename: input.step.title + ".mp4",
        });
    return {
      ...info,
      assets: [
        {
          id: asset.assetId,
          mediaType: frame ? "image" : "video",
          url: `/api/uploads/${asset.assetId}/file`,
        },
      ],
      ...(frame ? {} : { recordingAssetId: asset.assetId }),
    };
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}
