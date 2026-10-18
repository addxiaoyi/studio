import type { Pool } from "pg";
import type { ViewerResponse } from "@helstera/shared";
import type { AuthenticatedUser } from "../auth/types.js";
import { BootstrapError, type ViewerService } from "../features/bootstrap/ensure-user-foundation.js";

export function createLocalViewerService(
  db: Pool,
  systemAdminEmails: readonly string[] = [],
): ViewerService {
  return {
    async ensureViewer(user: AuthenticatedUser): Promise<ViewerResponse> {
      try {
        const client = await db.connect();
        try {
          await client.query("begin");
          await client.query("select pg_advisory_xact_lock(hashtext($1))", [user.id]);
          await client.query(
            `insert into app_users (id, email) values ($1, $2)
             on conflict (id) do update set email = excluded.email, updated_at = now()
             returning id`,
            [user.id, user.email],
          );
          if (systemAdminEmails.includes(user.email.toLowerCase())) {
            await client.query(
              "update app_users set system_role = 'admin', updated_at = now() where id = $1",
              [user.id],
            );
          }
          const profile = await client.query(
            "select id, email, display_name, avatar_url, system_role from app_users where id = $1",
            [user.id],
          );
          const workspaceRow = (await client.query(
            `insert into workspaces (owner_user_id, name) values ($1, $2)
             on conflict (owner_user_id) do update set owner_user_id = excluded.owner_user_id
             returning id, name`,
            [user.id, "Personal Workspace"],
          )).rows[0];
          if (!workspaceRow) throw new Error("personal workspace was not created");
          await client.query(
            `insert into workspace_members (workspace_id, user_id, role)
             values ($1, $2, 'owner') on conflict do nothing`,
            [workspaceRow.id, user.id],
          );
          await client.query("commit");
          const row = profile.rows[0];
          return {
            profile: {
              id: row.id,
              email: row.email,
              displayName: row.display_name?.trim() || row.email.split("@")[0],
              avatarUrl: row.avatar_url?.trim() || null,
            },
            workspace: { id: workspaceRow.id, name: workspaceRow.name, ownerUserId: user.id, type: "personal" },
            membership: { workspaceId: workspaceRow.id, userId: user.id, role: "owner" },
            isSystemAdmin: row.system_role === "admin",
          };
        } catch (error) {
          await client.query("rollback");
          throw error;
        } finally { client.release(); }
      } catch (error) {
        console.error("[local-bootstrap] failed:", error instanceof Error ? error.stack : error);
        throw new BootstrapError();
      }
    },
  };
}
