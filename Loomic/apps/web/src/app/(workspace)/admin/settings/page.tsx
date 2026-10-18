"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, ChevronDown, Eye, EyeOff, LockKeyhole, Pencil, Save, ServerCog, Settings2, X } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { ChatModelCard } from "./chat-model-card";
import { ModelEndpointCard } from "./model-endpoint-card";
import { fetchAdminEnv, fetchAdminModelSettings, fetchModels, updateAdminEnv, updateAdminModelSettings, updateAdminSettings } from "@/lib/server-api";

type EnvMap = Record<string, string>;
type SaveState = "idle" | "saving" | "saved" | "error";
type FieldConfig = { key: string; label: string; description?: string };
type AgentModel = { id: string; name: string; provider: string };

const baseFields: FieldConfig[] = [
  { key: "AUTH_PROVIDER", label: "认证提供方" }, { key: "DATABASE_URL", label: "数据库连接" },
  { key: "STORAGE_PROVIDER", label: "存储提供方" }, { key: "STORAGE_ROOT", label: "本地存储目录" },
  { key: "OPENAI_API_BASE", label: "OpenAI API 地址" }, { key: "WORKER_CONCURRENCY", label: "Worker 并发数" },
  { key: "VOLCES_BASE_URL", label: "VolcEngine API 地址" },
];
const providerFields: FieldConfig[] = [
  { key: "OPENAI_API_KEY", label: "OpenAI API Key" }, { key: "GOOGLE_API_KEY", label: "Google API Key" }, { key: "REPLICATE_API_TOKEN", label: "Replicate Token" },
];
const paymentFields: FieldConfig[] = [
  { key: "LEMONSQUEEZY_API_KEY", label: "Lemon Squeezy API Key" }, { key: "YEEPAY_MERCHANT_ID", label: "易支付商户号" }, { key: "YEEPAY_BASE_URL", label: "易支付地址" }, { key: "EPAY_BASE_URL", label: "Epay 地址" },
];
const mailFields: FieldConfig[] = [
  { key: "MAIL_HOST", label: "SMTP 主机" }, { key: "MAIL_PORT", label: "SMTP 端口" }, { key: "MAIL_USER", label: "SMTP 用户名" }, { key: "MAIL_FROM", label: "发件人地址" },
];
const socialFields: FieldConfig[] = [
  ["DOUYIN", "抖音"], ["XIAOHONGSHU", "小红书"], ["KUAISHOU", "快手"], ["ZHIHU", "知乎"], ["BILIBILI", "B 站"], ["WECHAT_CHANNELS", "视频号"], ["WECHAT_OFFICIAL", "公众号"],
].flatMap(([prefix, label]) => [
  { key: `${prefix}_CLIENT_ID`, label: `${label} Client ID` }, { key: `${prefix}_CLIENT_KEY`, label: `${label} Client Key` }, { key: `${prefix}_CLIENT_SECRET`, label: `${label} Client Secret` },
  { key: `${prefix}_OAUTH_SCOPES`, label: `${label} OAuth Scopes` }, { key: `${prefix}_AUTH_URL`, label: `${label} 授权地址` }, { key: `${prefix}_TOKEN_URL`, label: `${label} Token 地址` },
  { key: `${prefix}_OAUTH_REDIRECT_URI`, label: `${label} 回调地址` }, { key: `${prefix}_PUBLISH_REVIEWED`, label: `${label} 发布审核状态` },
]);
const sensitive = /KEY|TOKEN|SECRET|PASSWORD|PRIVATE/i;

function Field({ config, env, edits, disabled, onChange }: { config: FieldConfig; env: EnvMap; edits: EnvMap; disabled: boolean; onChange: (key: string, value: string) => void }) {
  const isSecret = sensitive.test(config.key);
  const [visible, setVisible] = useState(false);
  const hasConfigured = Boolean(env[config.key]);
  const current = edits[config.key] ?? (isSecret ? "" : env[config.key] ?? "");
  return <label className="block rounded-xl border border-border/50 bg-background/45 p-4"><span className="flex items-center justify-between gap-3 text-xs font-medium"><span>{config.label}</span><code className="truncate text-[10px] font-normal text-muted-foreground/70">{config.key}</code></span>{config.description && <span className="mt-1 block text-[11px] leading-5 text-muted-foreground">{config.description}</span>}<span className="relative mt-2 block"><input value={current} onChange={(event) => onChange(config.key, event.target.value)} disabled={disabled} type={isSecret && !visible ? "password" : "text"} placeholder={isSecret && hasConfigured ? "已配置，输入新值以替换" : "未配置"} className="h-10 w-full rounded-lg border border-border/60 bg-card px-3 pr-10 text-sm outline-none transition focus:border-foreground/40 disabled:opacity-60" />{isSecret && <button type="button" onClick={() => setVisible((value) => !value)} disabled={disabled} aria-label={visible ? "隐藏值" : "显示值"} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground hover:bg-muted">{visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}</button>}</span>{isSecret && hasConfigured && <span className="mt-1 block text-[10px] text-emerald-700">当前已有配置，服务端仅返回脱敏值</span>}</label>;
}

function SettingsSection({ title, description, icon: Icon, fields, env, edits, disabled, onChange, open, onToggle }: { title: string; description: string; icon: typeof Settings2; fields: FieldConfig[]; env: EnvMap; edits: EnvMap; disabled: boolean; onChange: (key: string, value: string) => void; open?: boolean; onToggle?: () => void }) {
  const content = <div className="mt-5 grid gap-3 md:grid-cols-2">{fields.map((field) => <Field key={field.key} config={field} env={env} edits={edits} disabled={disabled} onChange={onChange} />)}</div>;
  return <section className="rounded-2xl border border-border/50 bg-card/70 p-5 sm:p-6"><div className="flex items-start gap-3"><span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-foreground/8"><Icon className="size-4" /></span><div className="min-w-0 flex-1"><div className="flex items-start justify-between gap-3"><div><h2 className="text-sm font-semibold">{title}</h2><p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p></div>{onToggle && <button type="button" onClick={onToggle} aria-expanded={open} className="rounded-lg p-2 text-muted-foreground hover:bg-muted"><ChevronDown className={`size-4 transition-transform ${open ? "rotate-180" : ""}`} /></button>}</div>{onToggle ? open && content : content}</div></div></section>;
}

export default function SettingsPage() {
  const { session } = useAuth();
  const [model, setModel] = useState("");
  const [initialModel, setInitialModel] = useState("");
  const [chatModel, setChatModel] = useState("");
  const [initialChatModel, setInitialChatModel] = useState("");
  const [defaultModelUrl, setDefaultModelUrl] = useState("");
  const [chatModelUrl, setChatModelUrl] = useState("");
  const [defaultModelKey, setDefaultModelKey] = useState("");
  const [chatModelKey, setChatModelKey] = useState("");
  const [defaultKeyConfigured, setDefaultKeyConfigured] = useState(false);
  const [chatKeyConfigured, setChatKeyConfigured] = useState(false);
  const [env, setEnv] = useState<EnvMap>({});
  const [edits, setEdits] = useState<EnvMap>({});
  const [loading, setLoading] = useState(true);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [restartRequired, setRestartRequired] = useState(false);
  const [socialOpen, setSocialOpen] = useState(false);
  const [modelEditing, setModelEditing] = useState(false);
  const [availableModels, setAvailableModels] = useState<AgentModel[]>([]);
  const [chatSaveState, setChatSaveState] = useState<SaveState>("idle");
  const [chatMessage, setChatMessage] = useState<string | null>(null);
  const [endpointSaving, setEndpointSaving] = useState<"default" | "chat" | null>(null);
  const token = session?.access_token;
  const dirtyKeys = Object.keys(edits);
  const isDirty = model !== initialModel || dirtyKeys.length > 0;
  const configuredCount = useMemo(() => Object.values(env).filter(Boolean).length, [env]);

  useEffect(() => {
    if (!token) return;
    let active = true;
    setLoading(true);
    Promise.all([fetchAdminModelSettings(token), fetchAdminEnv(token), fetchModels()]).then(([modelSettings, config, catalog]) => {
      if (!active) return;
      const nextModel = String(modelSettings.data.default_model ?? "");
      const nextChatModel = String(modelSettings.data.chat_model ?? nextModel);
      setModel(nextModel); setInitialModel(nextModel); setChatModel(nextChatModel); setInitialChatModel(nextChatModel); setEnv(config.data); setAvailableModels(catalog.models);
      setDefaultModelUrl(modelSettings.data.default_model_url); setChatModelUrl(modelSettings.data.chat_model_url); setDefaultKeyConfigured(modelSettings.data.default_model_key_configured); setChatKeyConfigured(modelSettings.data.chat_model_key_configured);
    }).catch((cause) => { if (active) { setSaveState("error"); setMessage(cause instanceof Error ? cause.message : "设置加载失败"); } }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [token]);

  const selectedCatalogModel = availableModels.find((item) => item.id.replace(/^openai:/, "") === model.replace(/^openai:/, ""));
  const modelStatus = selectedCatalogModel ? `可用 · ${selectedCatalogModel.provider}` : model ? "自定义 / 未在当前目录匹配" : "未配置，将使用服务默认模型";

  function changeEnv(key: string, value: string) {
    setEdits((current) => ({ ...current, [key]: value })); setSaveState("idle"); setMessage(null);
  }

  async function save() {
    if (!token || !isDirty) return;
    setSaveState("saving"); setMessage(null);
    try {
      let savedModel = false; let savedEnv = false; let envResult: Awaited<ReturnType<typeof updateAdminEnv>> | null = null;
      if (model !== initialModel) { await updateAdminSettings(token, model); savedModel = true; }
      const values = Object.fromEntries(Object.entries(edits).filter(([, value]) => value.trim() !== ""));
      if (Object.keys(values).length > 0) { envResult = await updateAdminEnv(token, values); savedEnv = true; }
      if (!savedModel && !savedEnv) throw new Error("没有可保存的变更");
      const [settings, config] = await Promise.all([fetchAdminModelSettings(token), fetchAdminEnv(token)]);
      const nextModel = String(settings.data.default_model ?? "");
      setModel(nextModel); setInitialModel(nextModel); setEnv(config.data); setEdits({}); setRestartRequired(Boolean(envResult?.data.restartRequired)); setSaveState("saved"); setMessage(savedEnv ? "配置已保存；环境变量将在服务重启后完全生效。" : "默认模型已保存。");
    } catch (cause) { setSaveState("error"); setMessage(cause instanceof Error ? cause.message : "保存失败，请检查输入后重试"); }
  }

  async function saveChatModel() {
    if (!token || !chatModel.trim() || chatModel === initialChatModel) return;
    setChatSaveState("saving"); setChatMessage(null);
    try {
      const saved = await updateAdminModelSettings(token, { chatModel: chatModel.trim(), chatModelUrl, chatModelKey });
      setChatModel(saved.data.chat_model ?? chatModel); setInitialChatModel(saved.data.chat_model ?? chatModel); setChatModelKey(""); setChatKeyConfigured(Boolean(saved.data.chat_model_key_configured)); setChatSaveState("saved"); setChatMessage("聊天模型已保存，下一条聊天消息立即生效。");
    } catch (cause) { setChatSaveState("error"); setChatMessage(cause instanceof Error ? cause.message : "聊天模型保存失败"); }
  }

  async function saveEndpoint(kind: "default" | "chat") {
    if (!token) return;
    setEndpointSaving(kind);
    try {
      const saved = await updateAdminModelSettings(token, kind === "default" ? { defaultModel: model, defaultModelUrl, defaultModelKey } : { chatModel, chatModelUrl, chatModelKey });
      setDefaultModelUrl(saved.data.default_model_url); setChatModelUrl(saved.data.chat_model_url); setDefaultKeyConfigured(Boolean(saved.data.default_model_key_configured)); setChatKeyConfigured(Boolean(saved.data.chat_model_key_configured)); setDefaultModelKey(""); setChatModelKey("");
    } finally { setEndpointSaving(null); }
  }

  return <section className="space-y-7 px-4 py-6 sm:px-6 sm:py-8 lg:px-10 lg:py-10">
    <div className="flex items-center justify-between gap-3 rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 text-xs"><span className="text-muted-foreground">需要独立配置 API URL、Key、模型自动探测和显示名称？</span><a href="/admin/providers/" className="shrink-0 font-medium text-primary underline underline-offset-2">打开 Provider 配置</a></div>
    <header className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/60">System / Configuration</p><h1 className="mt-2 text-3xl font-semibold tracking-tight">系统设置</h1><p className="mt-2 max-w-2xl text-sm text-muted-foreground">把工作区默认行为、运行时环境和外部服务凭证分开管理。敏感值不会从服务端回显。</p></div><div className="flex items-center gap-2 text-xs text-muted-foreground"><span className="size-2 rounded-full bg-emerald-500" />{configuredCount} 项已配置</div></header>
    {restartRequired && <div className="flex items-start gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-900"><AlertTriangle className="mt-0.5 size-4 shrink-0" /><div><p className="font-medium">需要重启服务</p><p className="mt-1 text-xs leading-5">环境变量已经写入配置文件，但当前进程不会自动重载。请重启 Server/Worker，再验证相关能力。</p></div></div>}
    {message && <div role="status" className={`flex items-center gap-2 rounded-xl border p-3 text-sm ${saveState === "error" ? "border-destructive/20 bg-destructive/5 text-destructive" : "border-emerald-500/20 bg-emerald-500/5 text-emerald-800"}`}>{saveState === "saved" ? <Check className="size-4" /> : saveState === "error" ? <AlertTriangle className="size-4" /> : null}{message}</div>}
    <section className="rounded-2xl border border-border/50 bg-card/70 p-5 sm:p-6"><div className="flex items-start gap-3"><span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-foreground/8"><Settings2 className="size-4" /></span><div className="min-w-0 flex-1"><div className="flex items-start justify-between gap-3"><div><h2 className="text-sm font-semibold">工作区默认模型</h2><p className="mt-1 text-xs leading-5 text-muted-foreground">只影响当前工作区的 Agent 默认选择；用户显式选择模型时仍以用户选择为准。</p></div><button type="button" onClick={() => setModelEditing((value) => !value)} disabled={loading || saveState === "saving"} className="inline-flex h-9 items-center gap-2 rounded-lg border border-border/60 px-3 text-xs font-medium hover:bg-muted disabled:opacity-50">{modelEditing ? <X className="size-3.5" /> : <Pencil className="size-3.5" />}{modelEditing ? "取消编辑" : "编辑"}</button></div>{modelEditing ? <div className="mt-5 grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]"><label className="block text-sm font-medium">从可用目录选择<select value={selectedCatalogModel?.id ?? "__custom__"} onChange={(event) => { const next = event.target.value; if (next !== "__custom__") { setModel(next); setSaveState("idle"); setMessage(null); } }} className="mt-2 h-11 w-full rounded-xl border border-border/60 bg-background px-3 text-sm outline-none focus:border-foreground/40"><option value="__custom__">自定义模型 ID</option>{availableModels.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.id}</option>)}</select></label><label className="block text-sm font-medium">模型 ID<input value={model} onChange={(event) => { setModel(event.target.value); setSaveState("idle"); setMessage(null); }} maxLength={200} placeholder="例如：agnes-3.0-flash" className="mt-2 h-11 w-full rounded-xl border border-border/60 bg-background px-3 text-sm outline-none focus:border-foreground/40" /></label></div> : <div className="mt-5 flex items-center justify-between gap-3 rounded-xl border border-border/50 bg-background/45 px-4 py-3"><span className="font-mono text-sm">{model || "未配置"}</span><span className={`text-xs ${selectedCatalogModel ? "text-emerald-700" : "text-amber-700"}`}>{modelStatus}</span></div>}{modelEditing && <p className="mt-2 text-xs text-muted-foreground">保存后立即作为当前工作区默认值；自定义 ID 需要对应 Provider 已配置。</p>}</div></div></section>
    <ModelEndpointCard defaultUrl={defaultModelUrl} chatUrl={chatModelUrl} defaultKey={defaultModelKey} chatKey={chatModelKey} defaultKeyConfigured={defaultKeyConfigured} chatKeyConfigured={chatKeyConfigured} saving={endpointSaving} onDefaultUrlChange={setDefaultModelUrl} onChatUrlChange={setChatModelUrl} onDefaultKeyChange={setDefaultModelKey} onChatKeyChange={setChatModelKey} onSave={(kind) => void saveEndpoint(kind)} />
    <ChatModelCard value={chatModel} initialValue={initialChatModel} models={availableModels} saving={chatSaveState === "saving"} message={chatMessage} error={chatSaveState === "error"} onChange={(value) => { setChatModel(value); setChatSaveState("idle"); setChatMessage(null); }} onSave={() => void saveChatModel()} />
    <SettingsSection title="运行时与存储" description="控制服务启动时读取的基础环境。修改后需要重启服务才会完全生效。" icon={ServerCog} fields={baseFields} env={env} edits={edits} disabled={loading || saveState === "saving"} onChange={changeEnv} />
    <SettingsSection title="模型服务凭证" description="只显示当前是否已配置；输入新值会替换原凭证，服务端不会回显完整密钥。" icon={LockKeyhole} fields={providerFields} env={env} edits={edits} disabled={loading || saveState === "saving"} onChange={changeEnv} />
    <SettingsSection title="支付与计费" description="配置支付服务的基础地址和商户标识；真实到账仍以服务端回调和订单状态为准。" icon={Settings2} fields={paymentFields} env={env} edits={edits} disabled={loading || saveState === "saving"} onChange={changeEnv} />
    <SettingsSection title="邮件服务" description="用于系统邮件与通知发送。当前页面只负责保存配置，不代替真实投递验证。" icon={Settings2} fields={mailFields} env={env} edits={edits} disabled={loading || saveState === "saving"} onChange={changeEnv} />
    <SettingsSection title="社媒 OAuth 与发布" description="按平台维护 Client ID、Secret、Scopes 和回调地址；默认折叠，避免设置页一次展开几十个字段。" icon={Settings2} fields={socialFields} env={env} edits={edits} disabled={loading || saveState === "saving"} onChange={changeEnv} open={socialOpen} onToggle={() => setSocialOpen((value) => !value)} />
    <div className="sticky bottom-4 z-10 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border/60 bg-background/90 p-3 shadow-lg backdrop-blur-xl"><div className="flex items-center gap-2 text-xs text-muted-foreground">{isDirty ? <><span className="size-2 rounded-full bg-amber-500" />有未保存变更</> : <><Check className="size-3.5 text-emerald-600" />当前配置已同步</>}</div><button type="button" onClick={() => void save()} disabled={loading || saveState === "saving" || !isDirty} className="inline-flex h-10 items-center gap-2 rounded-xl bg-foreground px-4 text-sm text-background transition hover:bg-foreground/90 disabled:opacity-40"><Save className="size-4" />{saveState === "saving" ? "保存中…" : "保存设置"}</button></div>
  </section>;
}
