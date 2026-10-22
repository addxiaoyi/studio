const stageLabels: Record<string, string> = {
  queued: "等待执行",
  connecting: "连接浏览器",
  browser_starting: "启动隔离浏览器",
  page_loading: "浏览页面",
  saving_assets: "保存截图与录屏",
  recording_failed: "录屏未能完成",
  writing_report: "整理网站介绍",
  action_confirmation: "等待网页动作确认",
  action_approved: "动作已确认",
  action_rejected: "动作已拒绝",
  action_executed: "动作执行结果",
  retry_recovered: "恢复任务重试",
  retry_failed: "重试未能启动",
  completed: "任务完成",
  failed: "任务失败",
  canceled: "任务已取消",
};

export function formatWebsiteCaptureStage(stage: string): string {
  return stageLabels[stage] ?? stage.replaceAll("_", " ");
}

export function formatWebsiteCaptureEventTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}
