import type { BaseCheckpointSaver, BaseStore } from "@langchain/langgraph-checkpoint";

import type { ServerEnv } from "../../config/env.js";
import { createPostgresCheckpointer } from "./postgres-checkpointer.js";
import { createPostgresStore } from "./postgres-store.js";

export type AgentPersistence = {
  checkpointer: BaseCheckpointSaver;
  store: BaseStore;
};

export type AgentPersistenceService = {
  getPersistence(): Promise<AgentPersistence | null>;
};

export function createAgentPersistenceService(
  env: Pick<ServerEnv, "databaseUrl">,
  overrides?: {
    createCheckpointer?: typeof createPostgresCheckpointer;
    createStore?: typeof createPostgresStore;
  },
): AgentPersistenceService {
  let pendingPersistence: Promise<AgentPersistence> | null = null;

  return {
    async getPersistence() {
      const connectionString = env.databaseUrl;
      if (!connectionString) {
        return null;
      }

      if (!pendingPersistence) {
        // Both setup routines create the same schema. Run them sequentially to
        // avoid a PostgreSQL CREATE SCHEMA race on first use.
        pendingPersistence = (async () => {
          const checkpointer = await (
            overrides?.createCheckpointer ?? createPostgresCheckpointer
          )({ connectionString });
          const store = await (overrides?.createStore ?? createPostgresStore)({
            connectionString,
          });
          return { checkpointer, store };
        })()
          .catch((error) => {
            pendingPersistence = null;
            throw error;
          });
      }

      return pendingPersistence;
    },
  };
}
