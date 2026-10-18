"use client";

import { useAuth } from "@/lib/auth-context";
import { t, useLocale } from "@/lib/i18n";
import {
  type ProviderConfig,
  type ProviderModelConfig,
  createAdminProvider,
  deleteAdminProvider,
  fetchAdminAudit,
  fetchAdminProviderModels,
  fetchAdminProviders,
  fetchViewer,
  probeAdminProvider,
  updateAdminProvider,
  updateAdminProviderModel,
} from "@/lib/server-api";
import {
  Activity,
  Eye,
  EyeOff,
  FileText,
  KeyRound,
  Plus,
  Server,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { StyledSelect } from "@/components/ui/styled-select";

type ProviderKey = {
  id: number;
  label: string;
  value: string;
  enabled: boolean;
};

const fallbackModels = [
  ["gpt-image-2-1k", "图片", "未探测"],
  ["gpt-image-2-2k", "图片", "未探测"],
  ["gpt-image-2.5-4k", "图片", "未探测"],
  ["sora-2-12s", "视频", "未探测"],
  ["veo_3_1", "视频", "未探测"],
];

export default function ProviderAdminPage() {
  const copy = t(useLocale()).admin;
  const { session, loading: authLoading } = useAuth();
  const router = useRouter();
  const [baseUrl, setBaseUrl] = useState("https://kuaipao.ai/v1");
  const [apiFormat, setApiFormat] = useState<"openai" | "gemini" | "anthropic" | "custom">("openai");
  const [requestTemplate, setRequestTemplate] = useState("{}");
  const [responseTemplate, setResponseTemplate] = useState("{}");
  const [keys, setKeys] = useState<ProviderKey[]>([]);
  const [saved, setSaved] = useState<ProviderConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [visible, setVisible] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [accessDenied, setAccessDenied] = useState(false);
  const [authorized, setAuthorized] = useState(false);
  const [saving, setSaving] = useState(false);
  const [probing, setProbing] = useState(false);
  const [modelConfigs, setModelConfigs] = useState<
    Array<ProviderModelConfig & { providerId: string; providerLabel: string }>
  >([]);
  const [auditLogs, setAuditLogs] = useState<
    Awaited<ReturnType<typeof fetchAdminAudit>>["data"]
  >([]);
  const [savingModel, setSavingModel] = useState<string | null>(null);
  const [modelSearch, setModelSearch] = useState("");
  const [adminTab, setAdminTab] = useState<"overview" | "providers" | "models" | "activity">("overview");

  const loadProviders = useCallback(async () => {
    const token = session?.access_token;
    if (!token) return;
    try {
      const providers = (await fetchAdminProviders(token)).providers;
      setSaved(providers);
      const [groups, audit] = await Promise.all([
        Promise.all(
          providers.map(async (provider) =>
            (await fetchAdminProviderModels(token, provider.id)).models.map(
              (model) => ({
                ...model,
                providerId: provider.id,
                providerLabel: provider.label,
              }),
            ),
          ),
        ),
        fetchAdminAudit(token).catch(() => ({ ok: false, data: [] })),
      ]);
      setAuditLogs(audit.data);
      setModelConfigs(groups.flat());
      setAccessDenied(false);
    } catch (error) {
      setAccessDenied(
        error instanceof Error &&
          "code" in error &&
          (error as { code?: string }).code === "forbidden",
      );
      setNotice(error instanceof Error ? error.message : "无法加载管理员配置");
    } finally {
      setLoading(false);
    }
  }, [session?.access_token]);

  const visibleModelConfigs = useMemo(() => {
    const query = modelSearch.trim().toLowerCase();
    const filtered = query
      ? modelConfigs.filter((item) => `${item.modelId} ${item.displayName} ${item.providerLabel}`.toLowerCase().includes(query))
      : modelConfigs;
    return filtered.slice(0, query ? 200 : 100);
  }, [modelConfigs, modelSearch]);
  useEffect(() => {
    if (authLoading) return;
    if (!session?.access_token) {
      router.replace("/login");
      return;
    }
    void fetchViewer(session.access_token)
      .then((viewer) => {
        if (!viewer.isSystemAdmin) {
          router.replace("/home");
          return;
        }
        setAuthorized(true);
      })
      .catch(() => router.replace("/home"));
  }, [authLoading, session?.access_token, router]);

  useEffect(() => {
    if (authorized) void loadProviders();
  }, [authorized, loadProviders]);

  function addKey() {
    setKeys((current) => [
      ...current,
      {
        id: Date.now(),
        label: `Key ${current.length + 1}`,
        value: "",
        enabled: true,
      },
    ]);
  }

  function removeKey(id: number) {
    setKeys((current) => current.filter((item) => item.id !== id));
  }

  function updateKey(id: number, value: string) {
    setKeys((current) =>
      current.map((item) => (item.id === id ? { ...item, value } : item)),
    );
  }

  function toggleKey(id: number) {
    setKeys((current) =>
      current.map((item) =>
        item.id === id ? { ...item, enabled: !item.enabled } : item,
      ),
    );
  }

  async function saveConfig() {
    const token = session?.access_token;
    const pending = keys.filter((item) => item.value.trim());
    if (!token || pending.length === 0) {
      setNotice("请先登录并填写至少一个 API Key");
      return;
    }
    setSaving(true);
    try {
      const parseTemplate = (value: string) => {
        if (!value.trim() || value.trim() === "{}") return undefined;
        return JSON.parse(value) as unknown;
      };
      const templates = { requestTemplate: parseTemplate(requestTemplate), responseTemplate: parseTemplate(responseTemplate), apiFormat };
      for (const item of pending)
        await createAdminProvider(token, {
          label: item.label,
          baseUrl,
          key: item.value,
          enabled: item.enabled,
          ...templates,
        });
      setKeys([]);
      setNotice("配置已安全保存，Key 仅显示末 4 位");
      await loadProviders();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function removeSaved(id: string) {
    const token = session?.access_token;
    if (!token) return;
    try {
      await deleteAdminProvider(token, id);
      await loadProviders();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "删除失败");
    }
  }
  async function probeSaved(id: string, refresh = true) {
    const token = session?.access_token;
    if (!token) return;
    try {
      await probeAdminProvider(token, id);
      setNotice("模型探测完成");
      if (refresh) await loadProviders();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "探测失败");
      if (refresh) await loadProviders();
    }
  }
  async function toggleProvider(provider: ProviderConfig) {
    const token = session?.access_token;
    if (!token) return;
    try {
      await updateAdminProvider(token, provider.id, {
        label: provider.label,
        baseUrl: provider.baseUrl,
        enabled: !provider.enabled,
        ...(provider.apiFormat ? { apiFormat: provider.apiFormat } : {}),
      });
      setNotice(provider.enabled ? "供应商已停用" : "供应商已启用");
      await loadProviders();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "供应商状态更新失败");
    }
  }
  async function probeAll() {
    setProbing(true);
    setNotice(`正在探测 ${saved.length} 个供应商…`);
    try {
      const queue = [...saved];
      const worker = async () => {
        while (queue.length > 0) {
          const item = queue.shift();
          if (!item) return;
          await probeSaved(item.id, false);
        }
      };
      await Promise.all(Array.from({ length: Math.min(4, saved.length) }, () => worker()));
      setNotice("模型探测完成");
      await loadProviders();
    } finally {
      setProbing(false);
    }
  }
  function patchModel(
    providerId: string,
    modelId: string,
    patch: Partial<ProviderModelConfig>,
  ) {
    setModelConfigs((current) =>
      current.map((item) =>
        item.providerId === providerId && item.modelId === modelId
          ? { ...item, ...patch }
          : item,
      ),
    );
  }
  async function saveModel(
    model: ProviderModelConfig & { providerId: string },
  ) {
    const token = session?.access_token;
    if (!token) return;
    setSavingModel(`${model.providerId}:${model.modelId}`);
    try {
      await updateAdminProviderModel(token, model.providerId, model);
      setNotice(`已保存 ${model.displayName}`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "模型保存失败");
    } finally {
      setSavingModel(null);
    }
  }

  if (authLoading || loading || !authorized) {
    return (
      <main
        className="mx-auto max-w-6xl px-6 py-12 sm:px-8 sm:py-16"
        aria-busy="true"
      >
        <div className="h-4 w-24 animate-pulse rounded bg-muted" />
        <div className="mt-4 h-12 w-80 max-w-full animate-pulse rounded bg-muted" />
        <div className="mt-10 grid gap-6 lg:grid-cols-2">
          <div className="h-96 animate-pulse rounded-2xl bg-muted/60" />
          <div className="h-96 animate-pulse rounded-2xl bg-muted/60" />
        </div>
      </main>
    );
  }

  const activeProviderCount = saved.filter((item) => item.enabled).length;
  const activeModelCount = new Set(modelConfigs.filter((item) => item.enabled).map((item) => item.modelId.toLowerCase())).size;
  const modelBindingCount = modelConfigs.filter((item) => item.enabled).length;
  const normalizeModelStatus = (model: ProviderModelConfig) => {
    const status = String(model.healthStatus ?? "unknown").toLowerCase();
    if (status === "degraded" || status === "unhealthy") return "abnormal" as const;
    if (status === "healthy" && (model.failureCount ?? 0) === 0) return "verified" as const;
    return "unverified" as const;
  };
  const verifiedModelCount = modelConfigs.filter((item) => item.enabled && normalizeModelStatus(item) === "verified").length;
  const unverifiedModelCount = modelConfigs.filter((item) => item.enabled && normalizeModelStatus(item) === "unverified").length;
  const abnormalModelCount = modelConfigs.filter((item) => item.enabled && normalizeModelStatus(item) === "abnormal").length;

  return (
    <main className="mx-auto max-w-6xl px-6 py-12 sm:px-8 sm:py-16">
      <header className="mb-10 flex items-start justify-between gap-6">
        <div>
          <p className="eyebrow mb-3">Admin Center</p>
          <h1 className="display-md text-foreground">管理中心</h1>
          <p className="mt-3 max-w-2xl text-sm text-muted-foreground">
            集中管理模型网关、API Key、模型分配策略和操作审计。完整 Key
            只在录入时可见。
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700">
          <ShieldCheck className="size-4" /> 管理员区域
        </div>
      </header>

      <section aria-label="配置概览" className="mb-6 grid gap-3 sm:grid-cols-4">
        {[
          ["供应商", saved.length, "已保存的网关"],
          ["启用供应商", activeProviderCount, "参与生产调用"],
          ["独立模型", probing ? "探测中" : activeModelCount, probing ? "正在读取网关模型" : "按模型 ID 去重"],
          ["Provider 绑定", probing ? "探测中" : modelBindingCount, probing ? "正在读取网关模型" : "同一模型可能绑定多个网关"],
          ["已验证模型", verifiedModelCount, "真实生成成功"],
          ["未验证模型", unverifiedModelCount, "尚未真实生成验证"],
          ["异常模型", abnormalModelCount, "近期调用失败或不可用"],
        ].map(([label, value, hint]) => (
          <div
            key={String(label)}
            className="rounded-xl border border-border/40 bg-background/60 px-4 py-3"
          >
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">
              {value}
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>
          </div>
        ))}
      </section>

      {!accessDenied && unverifiedModelCount > 0 && (
        <section className="mb-6 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-900" role="status">
          <p className="font-medium">视频模型正在等待真实验证</p>
          <p className="mt-1 leading-6">当前有 {unverifiedModelCount} 个模型仅被网关声明存在，尚未完成真实生成验证，因此不会展示给普通用户，也不会参与生产调用。</p>
        </section>
      )}

      {accessDenied ? (
        <section className="rounded-2xl border border-destructive/20 bg-destructive/[0.04] p-8 text-center">
          <ShieldCheck className="mx-auto size-8 text-destructive/70" />
          <h2 className="mt-4 text-lg font-medium text-foreground">
            没有管理员权限
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            只有工作区所有者或管理员可以管理模型供应商。
          </p>
        </section>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <section className="glass-soft rounded-2xl border border-border/40 p-6">
            <div className="mb-6 flex items-center gap-3">
              <Server className="size-5 text-muted-foreground" />
              <div>
                <h2 className="font-medium text-foreground">网关连接</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  OpenAI 兼容 API 基址
                </p>
              </div>
            </div>
            <label className="text-xs text-muted-foreground" htmlFor="base-url">
              Base URL
            </label>
            <input
              id="base-url"
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
              className="mt-2 h-11 w-full rounded-xl border border-border/50 bg-background/60 px-3 text-sm outline-none focus:border-foreground/50"
            />
            <label className="mt-4 block text-xs text-muted-foreground" htmlFor="api-format">接口格式</label>
            <StyledSelect value={apiFormat} onChange={(value) => setApiFormat(value as typeof apiFormat)} aria-label="接口格式" options={[{ value: "openai", label: "OpenAI 兼容" }, { value: "gemini", label: "Gemini" }, { value: "anthropic", label: "Anthropic" }, { value: "custom", label: "自定义模板" }]} />
            {apiFormat === "custom" && <div className="mt-4 grid gap-3 sm:grid-cols-2"><label className="text-xs text-muted-foreground">请求模板 JSON<textarea value={requestTemplate} onChange={(event) => setRequestTemplate(event.target.value)} rows={4} className="mt-2 w-full rounded-xl border border-border/50 bg-background/60 p-3 font-mono text-xs text-foreground outline-none" /></label><label className="text-xs text-muted-foreground">响应模板 JSON<textarea value={responseTemplate} onChange={(event) => setResponseTemplate(event.target.value)} rows={4} className="mt-2 w-full rounded-xl border border-border/50 bg-background/60 p-3 font-mono text-xs text-foreground outline-none" /></label></div>}

            <div className="mt-8 flex items-center justify-between">
              <div>
                <h2 className="font-medium text-foreground">API Keys</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  支持多 Key 轮换和故障切换
                </p>
              </div>
              <button
                type="button"
                onClick={addKey}
                className="inline-flex items-center gap-2 rounded-lg border border-border/60 px-3 py-2 text-xs text-foreground hover:bg-foreground/[0.05]"
              >
                <Plus className="size-4" /> 添加 Key
              </button>
            </div>

            <div className="mt-4 space-y-3">
              {keys.map((item) => (
                <div
                  key={item.id}
                  className="rounded-xl border border-border/40 bg-background/40 p-3"
                >
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-xs font-medium text-foreground">
                      {item.label}
                    </span>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => toggleKey(item.id)}
                        className={`rounded-md px-2 py-1 text-xs ${item.enabled ? "text-emerald-700" : "text-muted-foreground"}`}
                      >
                        {item.enabled ? "启用" : "停用"}
                      </button>
                      <button
                        type="button"
                        onClick={() => removeKey(item.id)}
                        aria-label={`删除 ${item.label}`}
                        className="rounded-md p-1.5 text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <KeyRound className="size-4 shrink-0 text-muted-foreground" />
                    <input
                      type={visible === item.id ? "text" : "password"}
                      value={item.value}
                      onChange={(event) =>
                        updateKey(item.id, event.target.value)
                      }
                      placeholder="粘贴新的 API Key"
                      className="h-9 min-w-0 flex-1 bg-transparent text-sm outline-none"
                      autoComplete="off"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setVisible(visible === item.id ? null : item.id)
                      }
                      aria-label={visible === item.id ? "隐藏 Key" : "显示 Key"}
                      className="p-1.5 text-muted-foreground"
                    >
                      {visible === item.id ? (
                        <EyeOff className="size-4" />
                      ) : (
                        <Eye className="size-4" />
                      )}
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={saveConfig}
              disabled={saving || loading}
              className="mt-6 h-11 w-full rounded-xl bg-foreground text-sm font-medium text-background hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? "保存中..." : "保存供应商配置"}
            </button>
            {!loading && saved.length > 0 && (
              <div className="mt-6 border-t border-border/30 pt-5">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-sm font-medium text-foreground">
                    已保存供应商
                  </h3>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {saved.length} 个网关 · {activeProviderCount} 个启用
                  </span>
                </div>
                <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
                  {saved.map((item) => (
                    <div
                      key={`saved-${item.id}`}
                      className="flex items-center justify-between gap-3 rounded-xl border border-border/30 bg-background/40 px-3 py-2.5 text-xs"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-medium text-foreground">
                          {item.label}
                        </p>
                        <p className="truncate text-muted-foreground">
                          {item.baseUrl} · Key ·•••• {item.keyLast4}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <span className={item.healthStatus === "healthy" ? "text-emerald-600" : "text-amber-600"}>
                          {item.healthStatus === "healthy" ? "健康" : item.healthStatus}
                        </span>
                        <button type="button" onClick={() => void toggleProvider(item)} className="text-foreground">
                          {item.enabled ? "停用" : "启用"}
                        </button>
                        <button type="button" onClick={() => probeSaved(item.id)} className="text-foreground">
                          探测
                        </button>
                        <button type="button" onClick={() => removeSaved(item.id)} className="text-destructive">
                          删除
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {loading && (
              <p className="mt-3 text-xs text-muted-foreground">
                正在加载配置...
              </p>
            )}
            {notice && (
              <output className="mt-3 block rounded-lg bg-amber-500/10 p-3 text-xs text-amber-800">
                {notice}
              </output>
            )}
          </section>

          <section className="glass-soft rounded-2xl border border-border/40 p-6">
            <div className="mb-6 flex items-center justify-between">
              <div>
                <h2 className="font-medium text-foreground">模型能力</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  保存后可逐 Key 探测可用模型
                </p>
              </div>
              <button
                type="button"
                onClick={probeAll}
                disabled={probing || saved.length === 0}
                title={
                  saved.length === 0
                    ? "请先添加并保存至少一个 API Key"
                    : undefined
                }
                className="rounded-lg border border-border/50 px-3 py-2 text-xs text-foreground disabled:cursor-not-allowed disabled:text-muted-foreground"
              >
                {probing ? "探测中..." : "全部探测"}
              </button>
            </div>
            {saved.length === 0 && (
              <div className="mb-3 rounded-xl border border-amber-500/20 bg-amber-500/[0.06] p-4 text-xs text-amber-800">
                <p className="font-medium">还没有可探测的 Provider</p>
                <p className="mt-1 leading-5">
                  先点击左侧“添加 Key”，填写新 Key
                  并保存；保存成功后才能探测模型。为安全起见，已在聊天中暴露的旧
                  Key 不可使用。
                </p>
              </div>
            )}
            {modelConfigs.length > 0 && (
              <div className="mb-3 flex items-center gap-3">
                <input
                  value={modelSearch}
                  onChange={(event) => setModelSearch(event.target.value)}
                  placeholder="搜索模型名称、ID或 Provider"
                  className="h-9 min-w-0 flex-1 rounded-lg border border-border/50 bg-background px-3 text-xs"
                />
                <span className="shrink-0 text-xs text-muted-foreground">
                  显示 {visibleModelConfigs.length} / {modelConfigs.length}
                </span>
              </div>
            )}
            <div className="space-y-3">
              {modelConfigs.length === 0 && probing ? (
                <div className="rounded-xl border border-dashed border-amber-500/30 bg-amber-500/[0.06] p-6 text-center text-sm text-amber-800">
                  正在探测 Provider 模型列表，请等待当前探测完成。
                </div>
              ) : modelConfigs.length === 0 ?
                fallbackModels.map(([name, type, status]) => (
                    <div
                      key={name}
                      className="flex items-center justify-between rounded-xl border border-border/30 px-3 py-3"
                    >
                      <div>
                        <p className="text-sm text-foreground">{name}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {type}
                        </p>
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {status}
                      </span>
                    </div>
                  ))
                : modelConfigs.map((model) => (
                    <div
                      key={`${model.providerId}:${model.modelId}`}
                      className="rounded-xl border border-border/30 p-3"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <input
                            value={model.displayName}
                            onChange={(event) =>
                              patchModel(model.providerId, model.modelId, {
                                displayName: event.target.value,
                              })
                            }
                            className="w-full bg-transparent text-sm font-medium outline-none"
                          />
                          <p className="truncate text-[10px] text-muted-foreground">
                            {model.modelId} · {model.providerLabel}
                            <span className="ml-2">{normalizeModelStatus(model) === "verified" ? "已验证" : normalizeModelStatus(model) === "unverified" ? "未验证" : "异常"}</span>
                          </p>
                        </div>
                        <label className="flex items-center gap-1 text-xs">
                          <input
                            type="checkbox"
                            checked={model.enabled}
                            onChange={(event) =>
                              patchModel(model.providerId, model.modelId, {
                                enabled: event.target.checked,
                              })
                            }
                          />
                          启用
                        </label>
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-2">
                        <StyledSelect value={model.mediaType} onChange={(value) => patchModel(model.providerId, model.modelId, { mediaType: value as "image" | "video" })} aria-label={`${model.displayName} 媒体类型`} options={[{ value: "image", label: "图片" }, { value: "video", label: "视频" }]} />
                        <StyledSelect value={model.billingUnit} onChange={(value) => patchModel(model.providerId, model.modelId, { billingUnit: value as ProviderModelConfig["billingUnit"] })} aria-label={`${model.displayName} 计费单位`} options={[{ value: "per_generation", label: "按次" }, { value: "per_second", label: "按秒" }, { value: "per_million_tokens", label: "按 Token" }]} />
                        <label className="text-[10px] text-muted-foreground">
                          积分/次或秒
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={model.priceCredits}
                            onChange={(event) =>
                              patchModel(model.providerId, model.modelId, {
                                priceCredits: Number(event.target.value),
                              })
                            }
                            className="mt-1 h-8 w-full rounded-md border bg-background px-2 text-xs"
                          />
                        </label>
                        <label className="text-[10px] text-muted-foreground">
                          优先级
                          <input
                            type="number"
                            min="0"
                            value={model.priority}
                            onChange={(event) =>
                              patchModel(model.providerId, model.modelId, {
                                priority: Number(event.target.value),
                              })
                            }
                            className="mt-1 h-8 w-full rounded-md border bg-background px-2 text-xs"
                          />
                        </label>
                        {model.billingUnit === "per_million_tokens" && (
                          <>
                            <label className="text-[10px] text-muted-foreground">
                              输入 ¥/1M
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                value={model.inputTokenPriceCny ?? 0}
                                onChange={(event) =>
                                  patchModel(model.providerId, model.modelId, {
                                    inputTokenPriceCny: Number(
                                      event.target.value,
                                    ),
                                  })
                                }
                                className="mt-1 h-8 w-full rounded-md border bg-background px-2 text-xs"
                              />
                            </label>
                            <label className="text-[10px] text-muted-foreground">
                              输出 ¥/1M
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                value={model.outputTokenPriceCny ?? 0}
                                onChange={(event) =>
                                  patchModel(model.providerId, model.modelId, {
                                    outputTokenPriceCny: Number(
                                      event.target.value,
                                    ),
                                  })
                                }
                                className="mt-1 h-8 w-full rounded-md border bg-background px-2 text-xs"
                              />
                            </label>
                          </>
                        )}
                      </div>
                      <div className="mt-3 flex flex-wrap gap-3 text-[10px]">
                        <label>
                          <input
                            type="checkbox"
                            checked={model.supportsInputImage}
                            onChange={(event) =>
                              patchModel(model.providerId, model.modelId, {
                                supportsInputImage: event.target.checked,
                              })
                            }
                          />{" "}
                          输入图
                        </label>
                        <label>
                          <input
                            type="checkbox"
                            checked={model.supportsInputVideo}
                            onChange={(event) =>
                              patchModel(model.providerId, model.modelId, {
                                supportsInputVideo: event.target.checked,
                              })
                            }
                          />{" "}
                          输入视频
                        </label>
                        <label>
                          <input
                            type="checkbox"
                            checked={model.supportsAudio}
                            onChange={(event) =>
                              patchModel(model.providerId, model.modelId, {
                                supportsAudio: event.target.checked,
                              })
                            }
                          />{" "}
                          音频
                        </label>
                        <button
                          type="button"
                          onClick={() => void saveModel(model)}
                          disabled={
                            savingModel ===
                            `${model.providerId}:${model.modelId}`
                          }
                          className="ml-auto rounded-md bg-foreground px-3 py-1 text-background disabled:opacity-50"
                        >
                          {savingModel ===
                          `${model.providerId}:${model.modelId}`
                            ? "保存中"
                            : "保存"}
                        </button>
                      </div>
                    </div>
                  ))}
            </div>
            <div className="mt-6 rounded-xl border border-border/30 bg-background/30 p-4">
              <p className="text-xs font-medium text-foreground">分配策略</p>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">
                已探测模型按健康状态和延迟参与分配；未探测 Key 不参与生产调用。
              </p>
            </div>
          </section>
        </div>
      )}

      {!accessDenied && (
        <section
          className="mt-6 rounded-2xl border border-border/40 bg-background/60 p-6"
          aria-labelledby="audit-heading"
        >
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <FileText className="size-5 text-muted-foreground" />
              <div>
                <h2 id="audit-heading" className="font-medium text-foreground">
                  管理员审计日志
                </h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  记录供应商、模型和权限配置的变更。
                </p>
              </div>
            </div>
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <Activity className="size-3.5" /> 最近 {auditLogs.length} 条
            </span>
          </div>
          {auditLogs.length === 0 ? (
            <p className="mt-5 rounded-lg border border-dashed border-border/50 p-4 text-xs text-muted-foreground">
              暂无审计记录
            </p>
          ) : (
            <div className="mt-4 divide-y divide-border/40 rounded-lg border border-border/40">
              {auditLogs.slice(0, 10).map((entry) => (
                <div
                  key={entry.id}
                  className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-xs"
                >
                  <span className="font-medium text-foreground">
                    {entry.action}
                  </span>
                  <span className="text-muted-foreground">
                    {entry.target_type ?? "系统"}
                    {entry.target_id ? ` · ${entry.target_id}` : ""}
                  </span>
                  <time
                    className="text-muted-foreground"
                    dateTime={entry.created_at}
                  >
                    {new Date(entry.created_at).toLocaleString("zh-CN")}
                  </time>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </main>
  );
}
