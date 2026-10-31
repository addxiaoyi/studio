import type { Pool } from "pg";

type ConnectorId = "isolated-browser" | "desktop-agent" | "media-generation";

export class ConnectorDisabledError extends Error {
  readonly code = "connector_disabled";

  constructor(connectorId: ConnectorId) {
    super(`The ${connectorId} connector is disabled. Enable it in settings before continuing.`);
    this.name = "ConnectorDisabledError";
  }
}

export async function assertConnectorEnabled(
  db: Pick<Pool, "query">,
  workspaceId: string,
  userId: string,
  connectorId: ConnectorId,
) {
  const { rows } = await db.query<{ enabled: boolean }>(
    "select enabled from agent_connector_permissions where workspace_id=$1 and user_id=$2 and connector_id=$3",
    [workspaceId, userId, connectorId],
  );
  // Missing preferences predate connector settings and must not disable existing workflows.
  if (rows[0]?.enabled === false) {
    throw new ConnectorDisabledError(connectorId);
  }
}
