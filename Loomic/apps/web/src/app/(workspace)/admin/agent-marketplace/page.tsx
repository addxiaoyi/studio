"use client";

import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Plus, RefreshCw, Tags } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { getServerBaseUrl } from "@/lib/env";

type Kind = "skill" | "mcp" | "plugin";
type Version = { version: string; source_url: string; license: string | null; created_at: string };
type Item = { id: string; kind: Kind; name: string; description: string; source_url: string; version: string; license: string | null; status: "draft" | "published" | "hidden"; versions: Version[] };
type ItemDraft = { kind: Kind; name: string; slug: string; description: string; sourceUrl: string; version: string; license: string; manifest: string };
const emptyDraft: ItemDraft = { kind: "skill", name: "", slug: "", description: "", sourceUrl: "", version: "1.0.0", license: "", manifest: "{}" };

export default function AgentMarketplaceAdminPage() {
  const { session } = useAuth();
  const [items, setItems] = useState<Item[]>([]);
  const [draft, setDraft] = useState(emptyDraft);
  const [versionItem, setVersionItem] = useState<Item | null>(null);
  const [versionDraft, setVersionDraft] = useState({ version: "", sourceUrl: "", license: "", manifest: "{}" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const request = useCallback(async (path: string, init?: RequestInit) => {
    if (!session?.access_token) throw new Error("请先登录管理员账户。");
    const response = await fetch(`${getServerBaseUrl()}${path}`, { ...init, headers: { Authorization: `Bearer ${session.access_token}`, ...(init?.body ? { "Content-Type": "application/json" } : {}), ...init?.headers } });
    const payload = await response.json().catch(() => null) as { data?: unknown; error?: { message?: string } } | null;
    if (!response.ok) throw new Error(payload?.error?.message ?? `请求失败 (${response.status})`);
    return payload?.data;
  }, [session?.access_token]);

  const load = useCallback(async () => {
    const data = await request("/api/admin/agent-marketplace");
    setItems(Array.isArray(data) ? data as Item[] : []);
  }, [request]);

  useEffect(() => { void load().catch((cause) => setError(cause instanceof Error ? cause.message : "加载失败")); }, [load]);

  async function createItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy("create"); setError(null);
    try {
      let manifest: unknown;
      try { manifest = JSON.parse(draft.manifest); } catch { throw new Error("Manifest 必须是有效 JSON。"); }
      await request("/api/admin/agent-marketplace", { method: "POST", body: JSON.stringify({ ...draft, license: draft.license || null, manifest }) });
      setDraft(emptyDraft); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "创建条目失败"); }
    finally { setBusy(null); }
  }

  async function addVersion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!versionItem) return;
    setBusy(versionItem.id); setError(null);
    try {
      let manifest: unknown;
      try { manifest = JSON.parse(versionDraft.manifest); } catch { throw new Error("Manifest 必须是有效 JSON。"); }
      await request(`/api/admin/agent-marketplace/${versionItem.id}/versions`, { method: "POST", body: JSON.stringify({ ...versionDraft, license: versionDraft.license || null, manifest }) });
      setVersionItem(null); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "新增版本失败"); }
    finally { setBusy(null); }
  }

  async function setStatus(item: Item, status: Item["status"]) {
    setBusy(item.id); setError(null);
    try { await request(`/api/admin/agent-marketplace/${item.id}`, { method: "PATCH", body: JSON.stringify({ status }) }); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "状态更新失败"); }
    finally { setBusy(null); }
  }

  return <main className="agent-market-admin">
    <header className="agent-market-admin__header"><div><p>AGENT MARKETPLACE / ADMIN</p><h1>Agent 市场管理</h1><span>来源、版本、许可证和发布审核</span></div><button type="button" onClick={() => void load()}><RefreshCw aria-hidden="true"/>刷新</button></header>
    {error ? <p className="agent-market-admin__error" role="alert">{error}</p> : null}
    <section className="agent-market-admin__create"><h2><Plus aria-hidden="true"/>新建目录条目</h2><form onSubmit={(event) => void createItem(event)}>
      <label>类型<select value={draft.kind} onChange={(event) => setDraft((current) => ({ ...current, kind: event.target.value as Kind }))}><option value="skill">Skill</option><option value="mcp">MCP</option><option value="plugin">插件</option></select></label>
      <label>名称<input required maxLength={120} value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}/></label>
      <label>Slug<input value={draft.slug} onChange={(event) => setDraft((current) => ({ ...current, slug: event.target.value }))}/></label>
      <label>版本<input required value={draft.version} onChange={(event) => setDraft((current) => ({ ...current, version: event.target.value }))}/></label>
      <label>许可证<input placeholder="MIT / Apache-2.0" value={draft.license} onChange={(event) => setDraft((current) => ({ ...current, license: event.target.value }))}/></label>
      <label className="agent-market-admin__wide">HTTPS 来源<input required type="url" value={draft.sourceUrl} onChange={(event) => setDraft((current) => ({ ...current, sourceUrl: event.target.value }))}/></label>
      <label className="agent-market-admin__wide">简介<input maxLength={2000} value={draft.description} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))}/></label>
      <label className="agent-market-admin__wide">Manifest JSON<textarea rows={3} value={draft.manifest} onChange={(event) => setDraft((current) => ({ ...current, manifest: event.target.value }))}/></label>
      <button type="submit" disabled={busy === "create"}>{busy === "create" ? "创建中…" : "创建草稿"}</button>
    </form></section>
    <section className="agent-market-admin__items" aria-label="市场审核目录">{items.map((item) => <article key={item.id}>
      <div className="agent-market-admin__item-main"><span className={`agent-market-admin__kind is-${item.kind}`}>{item.kind}</span><div><h2>{item.name}</h2><p>{item.description}</p><a href={item.source_url} target="_blank" rel="noreferrer">{item.source_url}</a></div></div>
      <span>v{item.version}</span><span className={`agent-market-admin__status is-${item.status}`}>{item.status}</span>
      <div className="agent-market-admin__actions"><button type="button" onClick={() => { setVersionItem(item); setVersionDraft({ version: "", sourceUrl: item.source_url, license: item.license ?? "", manifest: "{}" }); }}><Tags aria-hidden="true"/>版本</button><button type="button" disabled={busy === item.id || item.status === "published"} onClick={() => void setStatus(item, "published")}>发布</button><button type="button" disabled={busy === item.id || item.status === "hidden"} onClick={() => void setStatus(item, "hidden")}>隐藏</button><button type="button" disabled={busy === item.id || item.status === "draft"} onClick={() => void setStatus(item, "draft")}>撤回</button></div>
      {item.versions?.length ? <details className="agent-market-admin__versions"><summary>版本历史 · {item.versions.length}</summary>{item.versions.map((version) => <p key={`${version.version}-${version.created_at}`}>v{version.version} · {version.license ?? "未声明许可证"} · {new Date(version.created_at).toLocaleString()}</p>)}</details> : null}
    </article>)}</section>
    {versionItem ? <div className="agent-market-admin__overlay"><form onSubmit={(event) => void addVersion(event)}><header><h2>{versionItem.name} · 新版本</h2><button type="button" onClick={() => setVersionItem(null)} aria-label="关闭">×</button></header><label>版本<input required value={versionDraft.version} onChange={(event) => setVersionDraft((current) => ({ ...current, version: event.target.value }))}/></label><label>HTTPS 来源<input required type="url" value={versionDraft.sourceUrl} onChange={(event) => setVersionDraft((current) => ({ ...current, sourceUrl: event.target.value }))}/></label><label>许可证<input value={versionDraft.license} onChange={(event) => setVersionDraft((current) => ({ ...current, license: event.target.value }))}/></label><label>Manifest JSON<textarea rows={4} value={versionDraft.manifest} onChange={(event) => setVersionDraft((current) => ({ ...current, manifest: event.target.value }))}/></label><button type="submit" disabled={busy === versionItem.id}>{busy === versionItem.id ? "保存中…" : "保存版本"}</button></form></div> : null}
  </main>;
}
