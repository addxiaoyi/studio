import type { AgentGoal } from "@helstera/shared";

type Props = {
  goal: AgentGoal;
  english: boolean;
  busy: boolean;
  onReview: (approvalId: string, outcome: "observed_completed" | "observed_not_completed") => void;
};

export function AgentActionReview({ goal, english, busy, onReview }: Props) {
  const reviews = goal.tasks.flatMap((task) => {
    const action = task.checkpoint?.action;
    if (!action || typeof action !== "object") return [];
    const checkpoint = action as { approvalId?: unknown; state?: unknown };
    if (typeof checkpoint.approvalId !== "string" || !["dispatched", "uncertain"].includes(String(checkpoint.state))) return [];
    const approval = goal.approvals.find((item) => item.approvalId === checkpoint.approvalId && item.taskId === task.taskId);
    return approval ? [{ task, approval }] : [];
  });
  if (!reviews.length) return null;
  return <section className="agent-workspace-section agent-action-review" aria-label={english ? "Interrupted action review" : "中断动作核验"}>
    <h3>{english ? "Action needs review" : "动作需要核验"}</h3>
    {reviews.map(({ task, approval }) => {
      const screenshot = task.result?.screenshotAsset as { url?: unknown } | undefined;
      return <div key={approval.approvalId} className="agent-action-review__item">
        <p>{english ? "The connection was interrupted. Check the target before recording what happened." : "连接中断，请先检查目标，再记录动作是否完成。"}</p>
        <dl><dt>{english ? "Action" : "动作"}</dt><dd>{approval.action.kind}</dd>
          {approval.action.target || approval.action.targetUrl ? <><dt>{english ? "Target" : "目标"}</dt><dd>{approval.action.target ?? approval.action.targetUrl}</dd></> : null}
          {typeof approval.action.x === "number" && typeof approval.action.y === "number" ? <><dt>{english ? "Position" : "位置"}</dt><dd>{approval.action.x}, {approval.action.y}</dd></> : null}</dl>
        {typeof screenshot?.url === "string" ? <a href={screenshot.url}>{english ? "View saved screenshot" : "查看已保存的截图"}</a> : <p>{english ? "No saved screenshot is available." : "没有可用的已保存截图。"}</p>}
        <p>{english ? "Recording an observation does not replay or resume the task." : "记录观察结果不会重放动作或继续任务。"}</p>
        {task.reviewAvailable ? <div className="agent-action-review__actions">
          <button type="button" disabled={busy} onClick={() => onReview(approval.approvalId, "observed_completed")}>{english ? "Observed completed" : "确认已完成"}</button>
          <button type="button" disabled={busy} onClick={() => onReview(approval.approvalId, "observed_not_completed")}>{english ? "Observed not completed" : "确认未完成"}</button>
        </div> : <p role="status">{english ? "Review is available only after the desktop connection is disconnected and the task has stopped." : "任务停止且桌面连接断开后才能核验。"}</p>}
      </div>;
    })}
  </section>;
}
