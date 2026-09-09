import { createClient } from "@supabase/supabase-js";
import pg from "pg";

const sourceUrl = process.env.SUPABASE_URL;
const sourceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const targetUrl = process.env.DATABASE_URL;
if (!sourceUrl || !sourceKey || !targetUrl) throw new Error("SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and DATABASE_URL are required");

const source = createClient(sourceUrl, sourceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const target = new pg.Pool({ connectionString: targetUrl, max: 2 });

async function copyTable(table: string, columns: string[]) {
  const { data, error } = await source.from(table).select(columns.join(","));
  if (error) throw new Error(`${table}: ${error.message}`);
  for (const row of data ?? []) {
    const values = columns.map((column) => (row as unknown as Record<string, unknown>)[column]);
    const placeholders = columns.map((_, index) => `$${index + 1}`).join(", ");
    await target.query(`insert into ${table} (${columns.join(", ")}) values (${placeholders}) on conflict do nothing`, values);
  }
  console.log(`${table}: ${data?.length ?? 0} rows`);
}

const users = await source.auth.admin.listUsers({ perPage: 1000 });
if (users.error) throw users.error;
for (const user of users.data.users) {
  await target.query("insert into app_users (id, email, display_name, avatar_url, created_at, updated_at) values ($1,$2,$3,$4,$5,$6) on conflict (id) do update set email = excluded.email, updated_at = now()", [user.id, user.email, user.user_metadata?.display_name ?? user.user_metadata?.full_name ?? null, user.user_metadata?.avatar_url ?? null, user.created_at, user.updated_at ?? user.created_at]);
}

await copyTable("workspaces", ["id", "name", "owner_user_id", "created_at", "updated_at"]);
await copyTable("workspace_members", ["workspace_id", "user_id", "role", "created_at"]);
await copyTable("projects", ["id", "workspace_id", "created_by", "name", "slug", "description", "archived_at", "created_at", "updated_at"]);
await copyTable("canvases", ["id", "project_id", "created_by", "name", "is_primary", "content", "created_at", "updated_at"]);
await copyTable("chat_sessions", ["id", "canvas_id", "created_by", "thread_id", "title", "created_at", "updated_at"]);
await copyTable("chat_messages", ["id", "session_id", "role", "content", "tool_activities", "content_blocks", "created_at"]);
await copyTable("brand_kits", ["id", "user_id", "name", "is_default", "guidance_text", "cover_url", "created_at", "updated_at"]);
await copyTable("brand_kit_assets", ["id", "kit_id", "asset_type", "display_name", "role", "sort_order", "text_content", "file_url", "metadata", "created_at", "updated_at"]);
await copyTable("skills", ["id", "name", "slug", "description", "author", "version", "license", "category", "icon_name", "source", "skill_content", "metadata", "is_featured", "created_by", "created_at", "updated_at"]);
await copyTable("skill_files", ["id", "skill_id", "file_path", "content", "mime_type", "created_at", "updated_at"]);
await copyTable("workspace_skills", ["id", "workspace_id", "skill_id", "enabled", "config", "installed_at", "installed_by"]);
await target.end();
