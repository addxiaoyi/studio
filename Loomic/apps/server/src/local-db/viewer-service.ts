import type { Pool } from "pg";
import type { ViewerResponse } from "@helstera/shared";
import type { AuthenticatedUser } from "../supabase/user.js";
import { BootstrapError, type ViewerService } from "../features/bootstrap/ensure-user-foundation.js";

export function createLocalViewerService(db: Pool): ViewerService {
  return {
    async ensureViewer(user: AuthenticatedUser): Promise<ViewerResponse> {
      try {
        const client = await db.connect();
        try {
          await client.query("begin");
          const profile = await client.query(
            `insert into app_users (id, email) values ($1, $2)
             on conflict (id) do update set email = excluded.email, updated_at = now()
             returning id, email, display_name, avatar_url`,
            [user.id, user.email],
          );
          const workspace = await client.query(
            `insert into workspaces (owner_user_id, name) values ($1, $2)
             on conflict do nothing returning id, name`,
            [user.id, "Personal Workspace"],
          );
          const workspaceRow = workspace.rows[0] ?? (await client.query(
            "select id, name from workspaces where owner_user_id = $1 order by created_at limit 1",
            [user.id],
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
            profile: { id: row.id, email: row.email, displayName: row.display_name ?? row.email.split("@")[0], avatarUrl: row.avatar_url },
            workspace: { id: workspaceRow.id, name: workspaceRow.name, ownerUserId: user.id, type: "personal" },
            membership: { workspaceId: workspaceRow.id, userId: user.id, role: "owner" },
          };
        } catch (error) {
          await client.query("rollback");
          throw error;
        } finally { client.release(); }
      } catch (error) {
        console.error("[local-bootstrap] failed:", error);
        throw new BootstrapError();
      }
    },
  };
}
