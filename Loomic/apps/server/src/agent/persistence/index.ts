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
  close?(): Promise<void>;
};

export function createAgentPersistenceService(
  env: Pick<ServerEnv, "databaseUrl">,
  overrides?: {
    createCheckpointer?: typeof createPostgresCheckpointer;
    createStore?: typeof createPostgresStore;
  },
): AgentPersistenceService {
  let pendingPersistence: Promise<AgentPersistence> | null = null;
  let closeCheckpointer: (() => Promise<void>) | undefined;
  let closeStore: (() => Promise<void>) | undefined;
  let closed = false;

  return {
    async close() {
      closed = true;
      await pendingPersistence?.catch(() => undefined);
      await Promise.all([closeStore?.(), closeCheckpointer?.()]);
    },
    async getPersistence() {
      if (closed) throw new Error("Agent persistence has closed");
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
          closeCheckpointer = () => checkpointer.end();
          const store = await (overrides?.createStore ?? createPostgresStore)({
            connectionString,
          });
          closeStore = () => store.stop();
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
