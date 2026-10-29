"use client";

import type { ToolBlock } from "@helstera/shared";
import { useLocale } from "@/lib/i18n";

const labels: Record<string, { zh: string; en: string }> = {
  screen_observe: { zh: "观察屏幕", en: "Observe screen" },
  screen_click: { zh: "点击控件", en: "Click control" },
  screen_type: { zh: "输入文本", en: "Type text" },
  screen_key: { zh: "按下按键", en: "Press key" },
  screen_scroll: { zh: "滚动窗口", en: "Scroll window" },
  screen_drag: { zh: "拖动控件", en: "Drag control" },
  screen_wait_for_text: { zh: "等待屏幕文本", en: "Wait for screen text" },
  screen_list_windows: { zh: "列出窗口", en: "List windows" },
  screen_focus_window: { zh: "切换窗口", en: "Focus window" },
  screen_clipboard_read: { zh: "读取剪贴板", en: "Read clipboard" },
  screen_clipboard_write: { zh: "写入剪贴板", en: "Write clipboard" },
  screen_launch_app: { zh: "启动应用", en: "Launch app" },
  screen_close_app: { zh: "关闭应用", en: "Close app" },
  screen_find: { zh: "视觉定位", en: "Visual grounding" },
};

const secretKey = /password|passwd|otp|token|secret|cookie|credential|authorization|clipboard|base64/i;
const hiddenInput = new Set(["screen_type", "screen_clipboard_write"]);

function displayValue(value: unknown) {
  if (typeof value === "string") return value.slice(0, 120);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return `[${value.length}]`;
  if (value && typeof value === "object") return "{…}";
  return String(value ?? "—");
}

function inputSummary(block: ToolBlock, english: boolean) {
  const input = block.input ?? {};
  const entries = Object.entries(input).slice(0, 5);
  if (!entries.length) return english ? "No arguments" : "无参数";
  return entries.map(([key, value]) => {
    const hidden = secretKey.test(key) || (hiddenInput.has(block.toolName) && ["text", "value"].includes(key));
    return `${key}: ${hidden ? (english ? "[hidden]" : "[已隐藏]") : displayValue(value)}`;
  }).join(" · ");
}

function parsedObservation(output: Record<string, unknown> | undefined) {
  if (!output) return null;
  const candidates = [output, output.result, output.content, output.text];
  for (const candidate of candidates) {
    if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) return candidate as Record<string, unknown>;
    if (typeof candidate === "string") {
      try {
        const parsed: unknown = JSON.parse(candidate);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
      } catch {
        continue;
      }
    }
  }
  return null;
}

function resultSummary(block: ToolBlock, english: boolean) {
  if (block.status === "running") return english ? "Action is running" : "正在执行操作";
  if (block.status === "failed") return sanitize(block.outputSummary || (english ? "Action failed" : "操作失败"));
  if (block.toolName === "screen_clipboard_read") return english ? "Read completed; clipboard contents are hidden" : "读取完成，剪贴板内容已隐藏";
  if (block.toolName === "screen_type" || block.toolName === "screen_clipboard_write") return english ? "Completed; entered text is hidden" : "操作完成，输入内容已隐藏";
  if (block.toolName === "screen_observe") {
    const observation = parsedObservation(block.output);
    const title = typeof observation?.windowTitle === "string" ? observation.windowTitle : null;
    const controlCount = Array.isArray(observation?.controls) ? observation.controls.length : null;
    const prefix = english ? "Screen inspected" : "屏幕已读取";
    return [prefix, title, controlCount === null ? null : english ? `${controlCount} controls` : `${controlCount} 个控件`].filter(Boolean).join(" · ");
  }
  return sanitize(block.outputSummary || (english ? "Action completed" : "操作已完成"));
}

function sanitize(value: string) {
  return value
    .replace(/(password|passwd|otp|token|secret|cookie|authorization)\s*[:=]\s*[^\s,;]+/gi, "$1=[hidden]")
    .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, "[hidden key]")
    .slice(0, 240);
}

export function DesktopMcpToolCard({ block }: { block: ToolBlock }) {
  const english = useLocale() === "en-US";
  const label = labels[block.toolName]?.[english ? "en" : "zh"] ?? block.toolName;

  return <section className="desktop-mcp-tool-card" aria-label={english ? "Desktop MCP tool call" : "桌面 MCP 工具调用"}>
    <header><strong>{label}</strong><span>{block.status === "running" ? english ? "Running" : "执行中" : block.status === "failed" ? english ? "Failed" : "失败" : english ? "Completed" : "已完成"}</span></header>
    <p><b>{english ? "Arguments" : "参数"}</b> · {inputSummary(block, english)}</p>
    <p><b>{english ? "Result" : "结果"}</b> · {resultSummary(block, english)}</p>
  </section>;
}
