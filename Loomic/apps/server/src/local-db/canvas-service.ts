import type { CanvasContent, CanvasDetail } from "@helstera/shared";
import type { Pool } from "pg";
import type { AuthenticatedUser } from "../auth/types.js";
import {
  type CanvasService,
  CanvasServiceError,
} from "../features/canvas/canvas-service.js";

/**
 * 一次保存的结果。
 * `conflict` 表示调用方给的 baseVersion 已经被别的窗口推进过 —— 服务端**没有写入**，
 * `version` 是数据库里当前的版本号，交由调用方决定「重新加载」还是「覆盖保存」。
 */
export type CanvasSaveOutcome =
  | { status: "saved"; version: number }
  | { status: "conflict"; version: number };

/**
 * 版本化画布服务。
 *
 * 为什么在 local-db 里扩展、而不是改 `CanvasService` 或 `@helstera/shared`：
 * 契约包与 `features/` 目录由其它分支占用（本次修复的写入范围只到 http/ 与 local-db/），
 * 所以版本能力以「结构化扩展类型」的方式叠加，`createLocalCanvasService` 的返回值
 * 在结构上仍然是合法 `CanvasService`（app.ts 的 `canvasService?: CanvasService` 不受影响）。
 */
export type VersionedCanvasService = CanvasService & {
  getCanvasWithVersion(
    user: AuthenticatedUser,
    canvasId: string,
  ): Promise<{ canvas: CanvasDetail; version: number }>;
  saveCanvasContentWithVersion(
    user: AuthenticatedUser,
    canvasId: string,
    content: CanvasContent,
    baseVersion: number | null,
  ): Promise<CanvasSaveOutcome>;
};

/** 迁移里 `canvases.version` 的默认值（见 migrations/20261029000000_canvas_content_version.sql）。 */
export const CANVAS_INITIAL_VERSION = 1;

const SELECT_CANVAS_VERSION_SQL = `select c.version from canvases c
  join projects p on p.id = c.project_id
  join workspace_members wm on wm.workspace_id = p.workspace_id
  where c.id = $1 and wm.user_id = $2`;

const SAVE_CANVAS_SQL = `update canvases c
  set content = $1, version = c.version + 1, updated_at = now()
  from projects p
  join workspace_members wm on wm.workspace_id = p.workspace_id
  where c.id = $2 and p.id = c.project_id and wm.user_id = $3 and c.version = $4
  returning c.version`;

/** 无版本信息的老客户端放行时，读-写之间被并发推进的极小窗口：重试几次而不是静默丢弃。 */
const LEGACY_SAVE_ATTEMPTS = 3;

export function createLocalCanvasService(db: Pool): VersionedCanvasService {
  async function readVersion(
    user: AuthenticatedUser,
    canvasId: string,
  ): Promise<number | null> {
    const { rows } = await db.query(SELECT_CANVAS_VERSION_SQL, [
      canvasId,
      user.id,
    ]);
    const row = rows[0];
    if (!row) return null;
    return normalizeVersion(row.version);
  }

  async function getCanvasWithVersion(
    user: AuthenticatedUser,
    canvasId: string,
  ): Promise<{ canvas: CanvasDetail; version: number }> {
    const { rows } = await db.query(
      `select c.id, c.name, c.project_id, c.content, c.version from canvases c
       join projects p on p.id = c.project_id
       join workspace_members wm on wm.workspace_id = p.workspace_id
       where c.id = $1 and wm.user_id = $2`,
      [canvasId, user.id],
    );
    const row = rows[0];
    if (!row) {
      throw new CanvasServiceError(
        "canvas_not_found",
        "Canvas not found.",
        404,
      );
    }
    return {
      canvas: {
        id: row.id,
        name: row.name,
        projectId: row.project_id,
        content: row.content as CanvasContent,
      },
      version: normalizeVersion(row.version),
    };
  }

  async function saveCanvasContentWithVersion(
    user: AuthenticatedUser,
    canvasId: string,
    content: CanvasContent,
    baseVersion: number | null,
  ): Promise<CanvasSaveOutcome> {
    const currentVersion = await readVersion(user, canvasId);
    if (currentVersion === null) {
      throw new CanvasServiceError(
        "canvas_not_found",
        "Canvas not found.",
        404,
      );
    }

    // 乐观并发：客户端带着「它编辑时看到的版本」，版本已被推进就直接拒绝，不写库。
    if (baseVersion !== null && baseVersion !== currentVersion) {
      return { status: "conflict", version: currentVersion };
    }

    // compare-and-swap：即使读与写之间有人抢先落库，这里的 where 也会落空。
    const result = await db.query(SAVE_CANVAS_SQL, [
      JSON.stringify(content),
      canvasId,
      user.id,
      currentVersion,
    ]);

    if (!result.rowCount) {
      // 读-写之间被并发推进（或被删除 / 失去权限）：再读一次区分冲突与 404。
      const latestVersion = await readVersion(user, canvasId);
      if (latestVersion === null) {
        throw new CanvasServiceError(
          "canvas_not_found",
          "Canvas not found.",
          404,
        );
      }
      return { status: "conflict", version: latestVersion };
    }

    return {
      status: "saved",
      version: normalizeVersion(
        (result.rows[0] as { version?: unknown } | undefined)?.version,
      ),
    };
  }

  return {
    getCanvasWithVersion,
    saveCanvasContentWithVersion,

    // --- CanvasService（老签名，保持向后兼容）---
    async getCanvas(
      user: AuthenticatedUser,
      canvasId: string,
    ): Promise<CanvasDetail> {
      const { canvas } = await getCanvasWithVersion(user, canvasId);
      return canvas;
    },

    async saveCanvasContent(
      user: AuthenticatedUser,
      canvasId: string,
      content: CanvasContent,
    ) {
      // 老调用方不带版本：每次保存前现读版本再 CAS，语义仍是「后写覆盖前写」，
      // 但不会因为读-写之间的并发推进而丢掉这次保存。
      for (let attempt = 0; attempt < LEGACY_SAVE_ATTEMPTS; attempt += 1) {
        const outcome = await saveCanvasContentWithVersion(
          user,
          canvasId,
          content,
          null,
        );
        if (outcome.status === "saved") return;
      }
      throw new CanvasServiceError(
        "canvas_save_failed",
        "Unable to save canvas.",
        500,
      );
    },
  };
}

function normalizeVersion(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 1
    ? Math.trunc(parsed)
    : CANVAS_INITIAL_VERSION;
}
