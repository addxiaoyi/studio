import type { Pool } from "pg";
import type { StreamEvent } from "@helstera/shared";

import type { ConnectionManager } from "../../ws/connection-manager.js";
import type { CanvasEventBuffer } from "../../ws/event-buffer.js";

type GoalEventRow = {
  id: number;
  goal_id: string;
  task_id: string | null;
  canvas_id: string | null;
  created_by: string;
  status: string;
  event_type: string;
  detail: string | null;
  payload: Record<string, unknown>;
  created_at: string | Date;
};

export class AgentGoalEventPublisher {
  private timer: ReturnType<typeof setInterval> | undefined;
  private lastEventId = 0;
  private polling = false;

  constructor(
    private readonly db: Pool,
    private readonly connectionManager: ConnectionManager,
    private readonly eventBuffer: CanvasEventBuffer,
    private readonly intervalMs = 750,
  ) {}

  start() {
    if (this.timer) return;
    void this.bootstrap();
    this.timer = setInterval(() => void this.poll(), this.intervalMs);
    this.timer.unref?.();
  }

  stop() {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = undefined;
  }

  private async bootstrap() {
    try {
      const { rows } = await this.db.query<{ id: number }>("select coalesce(max(id),0)::bigint as id from agent_goal_events");
      this.lastEventId = Number(rows[0]?.id ?? 0);
      await this.poll();
    } catch (error) {
      console.error("[agent-goal-events] bootstrap failed:", error);
    }
  }

  private async poll() {
    if (this.polling) return;
    this.polling = true;
    try {
      const { rows } = await this.db.query<GoalEventRow>(
        `select e.id,e.goal_id,e.task_id,g.canvas_id,g.created_by,g.status,e.event_type,e.detail,e.payload,e.created_at
           from agent_goal_events e
           join agent_goals g on g.id=e.goal_id
          where e.id>$1
          order by e.id asc
          limit 200`,
        [this.lastEventId],
      );
      for (const row of rows) {
        this.lastEventId = Math.max(this.lastEventId, Number(row.id));
        const event: StreamEvent = {
          type: "agent.goal",
          goalId: row.goal_id,
          ...(row.task_id ? { taskId: row.task_id } : {}),
          ...(row.canvas_id ? { canvasId: row.canvas_id } : {}),
          eventType: row.event_type,
          status: row.status,
          detail: row.detail,
          payload: row.payload ?? {},
          timestamp: new Date(row.created_at).toISOString(),
        };
        if (row.canvas_id) {
          this.eventBuffer.push(row.canvas_id, event);
          this.connectionManager.pushToCanvas(row.canvas_id, event);
        } else {
          this.connectionManager.pushToUser(row.created_by, event);
        }
      }
    } catch (error) {
      console.error("[agent-goal-events] poll failed:", error);
    } finally {
      this.polling = false;
    }
  }
}
