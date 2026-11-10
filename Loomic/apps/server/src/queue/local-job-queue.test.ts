import { expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { createLocalJobQueue } from "./local-job-queue.js";

it("leaves atomic job claiming to the worker", async () => {
  const client = {
    query: vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rows: [{ id: "job-1", job_type: "image_generation", payload: { prompt: "test" }, workspace_id: "workspace-1", canvas_id: null, session_id: null, attempt_count: 0, max_attempts: 3 }] })
      .mockResolvedValueOnce(undefined),
    release: vi.fn(),
  };
  const queue = createLocalJobQueue({ connect: vi.fn().mockResolvedValue(client) } as unknown as Pool);
  const [message] = await queue.read("image_generation_jobs", 120, 1);
  expect(message?.message).not.toHaveProperty("local_claimed");
  expect(message?.message).toMatchObject({ job_id: "job-1", attempt_count: 0 });
  expect(client.query).toHaveBeenCalledTimes(3);
  expect(String(client.query.mock.calls[1]?.[0])).not.toContain("status = 'running'");
});

it("waits between empty local polls and promptly exits on shutdown", async () => {
  const query=vi.fn(async () => ({ rows: [] })), release=vi.fn();
  const db={ connect:async () => ({ query,release }) } as unknown as Pool;
  const queue=createLocalJobQueue(db); const start=performance.now();
  let settled=false;
  const pending=queue.readWithPoll("image_generation_jobs",120,1,1,50).finally(() => { settled=true; });
  await new Promise(resolve => setTimeout(resolve,120)); expect(settled).toBe(false); await queue.shutdown();
  expect(await pending).toEqual([]); expect(performance.now()-start).toBeGreaterThanOrEqual(100);
  expect(query.mock.calls.length).toBeLessThan(15);
  expect(await queue.read("image_generation_jobs",120,1)).toEqual([]);
});

it("does not acquire more messages after shutdown interrupts a pending query", async () => {
  let finish!: (value: unknown) => void;
  const query=vi.fn(async (sql:string) => sql.startsWith("select") ? new Promise(resolve => { finish=resolve; }) : ({ rows: [] }));
  const queue=createLocalJobQueue({ connect:async () => ({ query,release:vi.fn() }) } as unknown as Pool);
  const pending=queue.readWithPoll("image_generation_jobs",120,1,1,50);
  await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
  await queue.shutdown();finish({ rows:[{ id:"job", job_type:"image_generation", payload:{},workspace_id:"workspace" }] });
  expect(await pending).toEqual([]);
});
