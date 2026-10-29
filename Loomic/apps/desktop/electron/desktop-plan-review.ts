import type { DesktopAgentAction, DesktopAgentExecutionMode } from "@helstera/shared";

export type DesktopPlanAction = Pick<DesktopAgentAction, "kind" | "target" | "targetUrl" | "key" | "durationMs" | "toX" | "toY">;

export function formatDesktopPlanReview(input: {
  goal: string;
  executionMode: DesktopAgentExecutionMode;
  actions: DesktopPlanAction[];
  english: boolean;
}) {
  const { goal, executionMode, actions, english } = input;
  const labels = english
    ? { plan: "Planned actions", none: "The Agent will inspect the active window and prepare the next step.", native: "Native desktop", isolated: "Isolated browser", connected: "Authorized browser tab", automatic: "Automatic", visual: "Native visual / OCR" }
    : { plan: "计划执行的操作", none: "Agent 将先观察当前窗口，再准备下一步。", native: "本机桌面", isolated: "隔离浏览器", connected: "授权浏览器标签", automatic: "自动选择", visual: "本机视觉 / OCR" };
  const mode = executionMode === "windows_ui" ? labels.native
    : executionMode === "visual_ocr" ? labels.visual
      : executionMode === "isolated_browser" ? labels.isolated
        : executionMode === "connected_browser_tab" ? labels.connected : labels.automatic;
  const actionLines = actions.map((action, index) => `${index + 1}. ${formatAction(action, english)}`);
  return [
    english ? `Goal: ${goal}` : `目标：${goal}`,
    english ? `Mode: ${mode}` : `模式：${mode}`,
    english ? labels.plan : labels.plan,
    ...(actionLines.length ? actionLines : [labels.none]),
  ].join("\n");
}

function formatAction(action: DesktopPlanAction, english: boolean) {
  const target = action.target || action.targetUrl || "";
  const labels: Record<string, [string, string]> = {
    focus_window: ["切换到窗口", "Focus window"],
    read_page: ["读取页面", "Read page"],
    navigate: ["打开网页", "Open page"],
    scroll: ["滚动页面", "Scroll page"],
    capture_screen: ["截取屏幕", "Capture screen"],
    start_recording: ["开始录屏", "Start recording"],
    stop_recording: ["停止录屏", "Stop recording"],
    click: ["点击网页控件", "Click web control"],
    type: ["在网页字段输入文本", "Enter text in web field"],
    native_click: ["点击桌面控件", "Click desktop control"],
    native_type: ["在桌面字段输入文本", "Enter text in desktop field"],
    native_key: ["按下桌面按键", "Press desktop key"],
    native_scroll: ["滚动桌面窗口", "Scroll desktop window"],
    native_drag: ["拖动桌面控件", "Drag desktop control"],
    native_double_click: ["双击桌面控件", "Double-click desktop control"],
    native_right_click: ["右键桌面控件", "Right-click desktop control"],
    native_wait_for_text: ["等待屏幕出现文本", "Wait for visible text"],
    wait: ["等待", "Wait"],
  };
  const label = labels[action.kind]?.[english ? 1 : 0] ?? action.kind;
  const safeTarget = action.kind === "native_key" ? action.key : target;
  const wait = action.kind === "wait" && typeof action.durationMs === "number" ? ` (${Math.ceil(action.durationMs / 1000)}s)` : "";
  const coordinates = action.kind === "native_drag" && typeof action.toX === "number" && typeof action.toY === "number"
    ? ` → (${action.toX}, ${action.toY})`
    : "";
  return `${label}${safeTarget ? `: ${safeTarget.slice(0, 160)}` : ""}${coordinates}${wait}`;
}
