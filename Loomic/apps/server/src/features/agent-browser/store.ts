import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Pool } from "pg";
import {
  agentBrowserSessionSchema,
  type AgentBrowserCursor,
  type AgentBrowserSession,
} from "@helstera/shared";

export const BROWSER_HEARTBEAT_MS = 15_000;
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
type Owner = { userId: string; workspaceId: string };
type Row = {
  id: string;
  task_id: string;
  engine: string;
  name: string;
  url: string;
  title: string;
  state: string;
  control: string;
  width: number;
  height: number;
  frame_revision: string | number;
  cursor: AgentBrowserCursor | null;
  detail: string;
  handoff?:boolean;
  login_origins?:string[];
  heartbeat_at: Date;
  updated_at: Date;
  expires_at: Date;
};

export function publicBrowserUrl(value: string) {
  try {
    const url = new URL(value);
    return /^https?:$/.test(url.protocol) ? url.origin + url.pathname : "";
  } catch {
    return "";
  }
}

export function browserViewStore(db: Pool, storageRoot: string) {
  function directory(id: string) {
    if (!UUID.test(id)) throw new Error("Invalid browser session identifier.");
    return join(storageRoot, "agent-browser-views", id);
  }
  function snapshot(row: Row): AgentBrowserSession {
    const interrupted =
      ["starting", "running", "paused"].includes(row.state) &&
      Date.now() - new Date(row.heartbeat_at).getTime() > BROWSER_HEARTBEAT_MS;
    return agentBrowserSessionSchema.parse({
      id: row.id,
      taskId: row.task_id,
      engine: row.engine,
      name: row.name,
      url: row.url,
      title: row.title,
      state: interrupted ? "interrupted" : row.state,
      control: row.control,
      width: row.width,
      height: row.height,
      frameRevision: Number(row.frame_revision),
      cursor: row.cursor,
      detail: row.detail,
      handoff:row.handoff??false,
      loginOrigins:row.login_origins??[],
      updatedAt: new Date(row.updated_at).toISOString(),
      expiresAt: new Date(row.expires_at).toISOString(),
    });
  }
  return {
    async create(
      input: Owner & {
        taskId: string;
        engine: "chromix" | "chromium";
        name: string;
      },
    ) {
      const id = randomUUID();
      await mkdir(directory(id), { recursive: true, mode: 0o700 });
      await db.query(
        "insert into agent_browser_views(id,task_id,workspace_id,user_id,engine,name) values($1,$2,$3,$4,$5,$6)",
        [
          id,
          input.taskId,
          input.workspaceId,
          input.userId,
          input.engine,
          input.name.slice(0, 160),
        ],
      );
      return id;
    },
    async list(owner: Owner) {
      const { rows } = await db.query<Row>(
        "select * from agent_browser_views where workspace_id=$1 and user_id=$2 and expires_at>now() order by updated_at desc limit 20",
        [owner.workspaceId, owner.userId],
      );
      return rows.map(snapshot);
    },
    async get(id: string, owner: Owner) {
      const { rows } = await db.query<Row>(
        "select * from agent_browser_views where id=$1 and workspace_id=$2 and user_id=$3 and expires_at>now()",
        [id, owner.workspaceId, owner.userId],
      );
      return rows[0] ? snapshot(rows[0]) : null;
    },
    async frame(id: string) {
      return readFile(join(directory(id), "frame.jpg"));
    },
    async enableHandoff(id:string){await db.query("update agent_browser_views set handoff=true where id=$1",[id]);},
    async loginOrigins(id:string,origins:string[]){await db.query('update agent_browser_views set login_origins=$2::jsonb where id=$1 and handoff=true',[id,JSON.stringify(origins)]);},
    async eraseLoginView(id:string){
      await db.query("update agent_browser_views set handoff=false,state='completed',expires_at=now(),updated_at=now() where id=$1",[id]);
      await rm(directory(id),{recursive:true,force:true});
    },
    async writeFrame(
      id: string,
      bytes: Buffer,
      input: { url: string; title: string; width: number; height: number },
    ) {
      if (bytes.length > 1024 * 1024)
        throw new Error("Browser preview exceeds its frame budget.");
      await writeFile(join(directory(id), "frame.next"), bytes, {
        mode: 0o600,
      });
      await rename(
        join(directory(id), "frame.next"),
        join(directory(id), "frame.jpg"),
      );
      await db.query(
        "update agent_browser_views set url=$2,title=$3,width=$4,height=$5,frame_revision=frame_revision+1,heartbeat_at=now(),updated_at=now() where id=$1 and state in ('starting','running','paused')",
        [
          id,
          publicBrowserUrl(input.url),
          input.title.slice(0, 200),
          input.width,
          input.height,
        ],
      );
    },
    async activity(
      id: string,
      cursor: AgentBrowserCursor | null,
      detail: string,
    ) {
      await db.query(
        "update agent_browser_views set cursor=$2::jsonb,detail=$3,state=case when control='paused' then 'paused' else 'running' end,heartbeat_at=now(),updated_at=now() where id=$1 and state in ('starting','running','paused')",
        [id, JSON.stringify(cursor), detail.slice(0, 500)],
      );
    },
    async checkpoint(id: string) {
      const { rows } = await db.query<{ control: "agent" | "paused" }>(
        "update agent_browser_views set heartbeat_at=now(),state=case when control='paused' then 'paused' else 'running' end where id=$1 and state in ('starting','running','paused') and expires_at>now() returning control",
        [id],
      );
      if (!rows[0]) throw new Error("Browser session has ended or expired.");
      return rows[0].control;
    },
    async control(id: string, owner: Owner, control: "agent" | "paused") {
      const { rows } = await db.query<{ id: string }>(
        "update agent_browser_views set control=$4,updated_at=now() where id=$1 and workspace_id=$2 and user_id=$3 and state in ('starting','running','paused') and heartbeat_at>now()-interval '15 seconds' and expires_at>now() returning id",
        [id, owner.workspaceId, owner.userId, control],
      );
      return Boolean(rows[0]);
    },
    async finish(id: string, state: "completed" | "failed", detail: string) {
      await db.query(
        "update agent_browser_views set state=$2,detail=$3,cursor=null,heartbeat_at=now(),updated_at=now(),expires_at=now()+interval '1 hour' where id=$1",
        [id, state, detail.slice(0, 500)],
      );
    },
    async prune() {
      const { rows } = await db.query<{ id: string }>(
        "select id from agent_browser_views where expires_at<now() limit 100",
      );
      for (const row of rows) {
        await rm(directory(row.id), { recursive: true, force: true });
        await db.query(
          "delete from agent_browser_views where id=$1 and expires_at<now()",
          [row.id],
        );
      }
      return rows.length;
    },
  };
}
export type BrowserViewStore = ReturnType<typeof browserViewStore>;
