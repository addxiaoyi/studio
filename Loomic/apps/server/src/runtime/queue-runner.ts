import { setTimeout as delay } from "node:timers/promises";

type Queue = { name: string; concurrency: number };
type QueueRunnerOptions<T> = {
  queues: readonly Queue[];
  poll(queue: string, available: number): Promise<T[]>;
  execute(queue: string, message: T): Promise<void>;
  onError(queue: string, error: unknown): void;
};

export function startQueueRunner<T>(options: QueueRunnerOptions<T>) {
  for (const queue of options.queues) {
    if (!Number.isInteger(queue.concurrency) || queue.concurrency < 1) throw new Error(`Invalid concurrency for ${queue.name}`);
  }
  const controller = new AbortController();
  const active = new Set<Promise<void>>();
  const pause = async (ms: number) => {
    try { await delay(ms, undefined, { signal: controller.signal }); }
    catch (error) { if (!controller.signal.aborted) throw error; }
  };
  const pump = async (queue: Queue) => {
    const jobs = new Set<Promise<void>>();
    while (!controller.signal.aborted) {
      if (jobs.size >= queue.concurrency) {
        await Promise.race(jobs);
        continue;
      }
      try {
        const messages = await options.poll(queue.name, queue.concurrency - jobs.size);
        if (controller.signal.aborted) break;
        for (const message of messages) {
          const job = Promise.resolve().then(() => options.execute(queue.name, message))
            .catch(error => options.onError(queue.name, error))
            .finally(() => { jobs.delete(job); active.delete(job); });
          jobs.add(job);
          active.add(job);
        }
        // Also bound polling implementations which return empty immediately.
        if (!messages.length) await pause(50);
      } catch (error) {
        if (controller.signal.aborted) break;
        options.onError(queue.name, error);
        await pause(1000);
      }
    }
  };
  const pumps = options.queues.map(pump);
  let stopping: Promise<void> | undefined;
  return {
    get activeCount() { return active.size; },
    stop() {
      controller.abort();
      stopping ??= (async () => {
        await Promise.all(pumps);
        await Promise.all([...active]);
      })();
      return stopping;
    },
  };
}
