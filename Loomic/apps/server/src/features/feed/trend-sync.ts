import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { XMLParser } from "fast-xml-parser";
import type { Pool } from "pg";

const MAX_SOURCE_BYTES = 2_000_000;
const xml = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });

type Source = { id: string; url: string; platform: string; source_type: "rss" | "api"; config: Record<string, unknown> };
type Item = { externalId: string; title: string; summary: string; url: string | null; publishedAt: string | null; heat: number | null; tags: string[] };

function list(value: unknown): unknown[] { return value == null ? [] : Array.isArray(value) ? value : [value]; }
function text(value: unknown): string { return typeof value === "string" || typeof value === "number" ? String(value) : ""; }
function cleanText(value: unknown): string {
  return text(value)
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}
async function allowedUrl(raw: string): Promise<URL> {
  const url = new URL(raw);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("趋势源仅支持 HTTP/HTTPS");
  const hostname = url.hostname.toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname === "metadata.google.internal" || hostname === "169.254.169.254") throw new Error("趋势源地址不允许访问本机或云元数据服务");
  const addresses = await lookup(hostname, { all: true, verbatim: true });
  for (const address of addresses) {
    const ip = address.address;
    if (ip === "127.0.0.1" || ip === "::1" || ip.startsWith("10.") || ip.startsWith("192.168.") || /^172\.(1[6-9]|2\d|3[0-1])\./.test(ip) || ip.startsWith("169.254.") || ip.startsWith("fc") || ip.startsWith("fd")) throw new Error("趋势源地址不允许访问内网或链路本地地址");
  }
  return url;
}
function field(record: Record<string, unknown>, key: unknown, fallback: string): unknown { return record[typeof key === "string" ? key : fallback]; }

async function download(source: Source): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    let target = await allowedUrl(source.url);
    const query = source.config?.query;
    if (query && typeof query === "object") {
      for (const [key, value] of Object.entries(query as Record<string, unknown>)) {
        if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") target.searchParams.set(key, String(value));
      }
    }
    const headers: Record<string, string> = {
      accept: source.source_type === "rss" ? "application/rss+xml, application/xml, text/xml" : "application/json",
    };
    const configuredHeaders = source.config?.headers;
    if (configuredHeaders && typeof configuredHeaders === "object") {
      for (const [key, value] of Object.entries(configuredHeaders as Record<string, unknown>)) {
        if (typeof value === "string" && key.length < 100) headers[key] = value;
      }
    }
    if (typeof source.config?.authorization === "string") headers.authorization = source.config.authorization;

    for (let hop = 0; hop <= 3; hop += 1) {
      const response = await fetch(target, { redirect: "manual", signal: controller.signal, headers });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) throw new Error("趋势源重定向缺少目标地址");
        target = await allowedUrl(new URL(location, target).toString());
        continue;
      }
      if (!response.ok) throw new Error(`趋势源返回 HTTP ${response.status}`);
      const body = await response.text();
      if (Buffer.byteLength(body) > MAX_SOURCE_BYTES) throw new Error("趋势源响应超过 2MB");
      return source.source_type === "rss" ? xml.parse(body) : JSON.parse(body);
    }
    throw new Error("趋势源重定向次数过多");
  } finally {
    clearTimeout(timer);
  }
}
function parseRss(payload: any): Item[] {
  const records = list(payload?.rss?.channel?.item ?? payload?.feed?.entry);
  return records.slice(0, 100).map((raw: any) => {
    const link = text(raw?.link?.['@_href'] ?? raw?.link ?? raw?.guid);
    const title = text(raw?.title);
    return { externalId: cleanText(raw?.guid?.['#text'] ?? raw?.guid ?? raw?.id ?? link ?? title), title: cleanText(title), summary: cleanText(raw?.description ?? raw?.summary ?? raw?.content), url: link || null, publishedAt: text(raw?.pubDate ?? raw?.published ?? raw?.updated) || null, heat: null, tags: list(raw?.category).map(cleanText).filter(Boolean) };
  }).filter((item) => item.title);
}

function parseApi(payload: any, config: Record<string, unknown>): Item[] {
  const path = text(config.itemsPath || "items").split(".").filter(Boolean);
  const records = list(path.reduce((value: any, key) => value?.[key], payload));
  return records.slice(0, 100).map((raw: any) => ({ externalId: cleanText(field(raw, config.idField, "id")), title: cleanText(field(raw, config.titleField, "title")), summary: cleanText(field(raw, config.summaryField, "summary")), url: cleanText(field(raw, config.urlField, "url")) || null, publishedAt: text(field(raw, config.publishedAtField, "publishedAt")) || null, heat: Number(field(raw, config.heatField, "heat")) || null, tags: list(field(raw, config.tagsField, "tags")).map(cleanText).filter(Boolean) })).filter((item) => item.title);
}

export async function syncTrendSource(db: Pool, source: Source): Promise<number> {
  const payload = await download(source);
  const items = source.source_type === "rss" ? parseRss(payload) : parseApi(payload, source.config ?? {});
  let saved = 0;
  for (const item of items) {
    const key = createHash("sha256").update(item.externalId || item.url || `${item.title}|${item.publishedAt ?? ""}`).digest("hex");
    await db.query(`insert into trend_items(workspace_id,source_id,external_id,platform,title,summary,source_url,heat,tags,dedupe_key,published_at) select workspace_id,id,$2,$3,$4,$5,$6,$7,$8,$9,$10 from trend_sources where id=$1 on conflict(workspace_id,dedupe_key) do update set title=excluded.title,summary=excluded.summary,source_url=excluded.source_url,heat=excluded.heat,tags=excluded.tags,published_at=excluded.published_at,fetched_at=now()`, [source.id,item.externalId,source.platform,item.title,item.summary,item.url,item.heat,item.tags,key,item.publishedAt]);
    saved += 1;
  }
  await db.query("update trend_sources set last_synced_at=now(),last_error=null,updated_at=now() where id=$1", [source.id]);
  return saved;
}

export async function syncDueTrendSources(db: Pool): Promise<void> {
  const { rows } = await db.query<Source>("select id,url,platform,source_type,config from trend_sources where enabled=true and (last_synced_at is null or last_synced_at + refresh_minutes * interval '1 minute' <= now()) order by last_synced_at nulls first limit 20");
  for (const source of rows) {
    try { await syncTrendSource(db, source); }
    catch (error) { await db.query("update trend_sources set last_error=$2,updated_at=now() where id=$1", [source.id, error instanceof Error ? error.message.slice(0,1000) : "趋势同步失败"]); }
  }
}
