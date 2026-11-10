import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { restoreBackupRequestSchema } from "@helstera/shared";
import type { RequestAuthenticator } from "../auth/types.js";
import type { ViewerService } from "../features/bootstrap/ensure-user-foundation.js";
import { BackupRestoreError, restoreProjectBackup } from "../features/projects/restore-backup.js";

export function registerProjectBackupRoutes(app: FastifyInstance, options: { db: Pool; auth: RequestAuthenticator; viewerService: ViewerService }) {
  app.post("/api/project-backups/restore", { bodyLimit: 16 * 1024 * 1024 }, async (request, reply) => {
    const user = await options.auth.authenticate(request);
    if (!user) return reply.code(401).send({ ok: false, error: { code: "unauthorized", message: "请先登录。" } });
    const parsed = restoreBackupRequestSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ ok: false, error: { code: "invalid_backup", message: "快照格式无效或超过恢复上限。" } });
    try {
      const viewer = await options.viewerService.ensureViewer(user);
      const restored = await restoreProjectBackup(options.db, user.id, viewer.workspace.id, parsed.data.snapshot, parsed.data.replacements);
      return { ok: true, data: restored };
    } catch (error) {
      request.log.error({ err: error }, "project backup restoration failed");
      return reply.code(error instanceof BackupRestoreError ? error.statusCode : 500).send({ ok: false, error: { code: "backup_restore_failed", message: error instanceof BackupRestoreError ? error.message : "恢复失败，未提交新工程，请重试。" } });
    }
  });
}
