import type { Pool } from "pg";
import {
  libraryBodySchema,
  portableWorkflow,
  type CreativeLibraryBody,
  type CreativeLibraryEntry,
} from "@helstera/shared";
import { assertWorkflowCanvas, WorkflowError } from "./service.js";

type Row = {
  id: string;
  name: string;
  description: string;
  body: CreativeLibraryBody;
  revision: number;
  updated_at: Date;
};
const view = (row: Row): CreativeLibraryEntry => ({
  id: row.id,
  name: row.name,
  description: row.description,
  body: libraryBodySchema.parse(row.body),
  revision: row.revision,
  updatedAt: row.updated_at.toISOString(),
});
export class CreativeLibraryService {
  constructor(private readonly db: Pool) {}
  async list(userId: string, canvasId: string) {
    const workspace = await assertWorkflowCanvas(this.db, userId, canvasId);
    const rows = await this.db.query<Row>(
      "select * from creative_library where workspace_id=$1 and created_by=$2 and archived_at is null order by updated_at desc limit 200",
      [workspace, userId],
    );
    return rows.rows.map(view);
  }
  async save(
    userId: string,
    canvasId: string,
    input: {
      name: string;
      description: string;
      body: CreativeLibraryBody;
      requestKey: string;
    },
  ) {
    const workspace = await assertWorkflowCanvas(this.db, userId, canvasId);
    const parsed = libraryBodySchema.parse(input.body);
    const body =
      parsed.kind === "workflow"
        ? { kind: "workflow", graph: portableWorkflow(parsed.graph) }
        : parsed;
    const saved = await this.db.query<Row>(
      `insert into creative_library(workspace_id,created_by,name,description,body,request_key)
      values($1,$2,$3,$4,$5::jsonb,$6) on conflict(workspace_id,created_by,request_key) do update set request_key=excluded.request_key returning *`,
      [
        workspace,
        userId,
        input.name,
        input.description,
        JSON.stringify(body),
        input.requestKey,
      ],
    );
    return view(saved.rows[0]!);
  }
  async archive(userId: string, canvasId: string, id: string, restore = false) {
    const workspace = await assertWorkflowCanvas(this.db, userId, canvasId);
    const changed = await this.db.query(
      "update creative_library set archived_at=case when $4 then null else now() end,updated_at=now() where id=$1 and workspace_id=$2 and created_by=$3 returning id",
      [id, workspace, userId, restore],
    );
    if (!changed.rows.length)
      throw new WorkflowError("素材模板不存在或无权访问。", 404);
  }
}
