"use client";

import { Save, Settings2 } from "lucide-react";

type ModelOption = { id: string; name: string };

export function ChatModelCard({
  value,
  initialValue,
  models,
  saving,
  message,
  error,
  onChange,
  onSave,
}: {
  value: string;
  initialValue: string;
  models: ModelOption[];
  saving: boolean;
  message: string | null;
  error: boolean;
  onChange: (value: string) => void;
  onSave: () => void;
}) {
  const selected = models.some((item) => item.id.replace(/^openai:/, "") === value.replace(/^openai:/, ""));

  return <section className="rounded-2xl border border-border/50 bg-card/70 p-5 sm:p-6"><div className="flex items-start gap-3"><span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-foreground/8"><Settings2 className="size-4" /></span><div className="min-w-0 flex-1"><div className="flex items-start justify-between gap-3"><div><h2 className="text-sm font-semibold">聊天模型</h2><p className="mt-1 text-xs leading-5 text-muted-foreground">只控制聊天 Agent 的模型，不影响图片、视频生成模型或工作区其他默认值。</p></div><button type="button" onClick={onSave} disabled={saving || !value.trim() || value === initialValue} className="inline-flex h-9 items-center gap-2 rounded-lg bg-foreground px-3 text-xs font-medium text-background disabled:opacity-40"><Save className="size-3.5" />{saving ? "保存中" : "保存聊天模型"}</button></div><div className="mt-5 grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]"><label className="block text-sm font-medium">从可用目录选择<select value={selected ? value : "__custom__"} onChange={(event) => onChange(event.target.value === "__custom__" ? value : event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-border/60 bg-background px-3 text-sm outline-none focus:border-foreground/40"><option value="__custom__">自定义聊天模型 ID</option>{models.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.id}</option>)}</select></label><label className="block text-sm font-medium">聊天模型 ID<input value={value} onChange={(event) => onChange(event.target.value)} maxLength={200} placeholder="例如：agnes-3.0-flash" className="mt-2 h-11 w-full rounded-xl border border-border/60 bg-background px-3 text-sm outline-none focus:border-foreground/40" /></label></div>{message && <p role="status" className={`mt-3 text-xs ${error ? "text-destructive" : "text-emerald-700"}`}>{message}</p>}<p className="mt-2 text-xs text-muted-foreground">当前聊天模型：<span className="font-mono">{value || "未配置"}</span>。自定义 ID 需要对应已启用 Provider。</p></div></div></section>;
}
