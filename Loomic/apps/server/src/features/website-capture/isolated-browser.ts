import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Agent, request as httpRequest } from "undici";
import { chromium, type Route, type WebSocketRoute } from "playwright";
import { z } from "zod";
import type { Pool, PoolClient } from "pg";
import type { StorageProvider } from "../../storage/storage-provider.js";
import type { WebsiteCaptureClaim, WebsiteCaptureEvidence, WebsiteCapturePage, WebsiteCaptureResult } from "@helstera/shared";

const PAGE_TIMEOUT_MS = 15_000;
const PAGE_SETTLE_MS = 650;
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_BYTES = 32 * 1024 * 1024;
const MAX_VIDEO_BYTES = 40 * 1024 * 1024;
const MAX_HEADINGS = 16;

const pageFactsSchema = z.object({
  url: z.string().url(),
  title: z.string(),
  description: z.string(),
  headings: z.array(z.string()),
  navigation: z.array(z.string()),
  links: z.array(z.string().url()),
});

export type CaptureTask = {
  id: string;
  workspace_id: string;
  created_by: string;
  start_url: string;
  page_limit: number;
  record_video: boolean;
  follow_external?: boolean;
};

type CaptureProgress = (percent: number, stage: string, detail?: string) => Promise<void>;

type PageFacts = Omit<WebsiteCapturePage, "assetId" | "screenshotUrl"> & {
  screenshot: Buffer;
  width: number;
  height: number;
};

const PAGE_FACTS_SCRIPT = String.raw`(maxHeadings) => {
  const document = globalThis.document;
  const location = globalThis.location;
  const clean = (value) => (value ?? "").replace(/\s+/g, " ").trim().slice(0, 500);
  const description = clean(
    document.querySelector('meta[name="description"]')?.getAttribute("content")
      ?? document.querySelector('meta[property="og:description"]')?.getAttribute("content"),
  );
  const headings = Array.from(document.querySelectorAll("h1, h2, h3"))
    .map((heading) => clean(heading.textContent))
    .filter(Boolean)
    .slice(0, maxHeadings);
  const navigation = Array.from(document.querySelectorAll("header a, nav a"))
    .map((anchor) => clean(anchor.textContent))
    .filter(Boolean)
    .slice(0, 24);
  const links = Array.from(document.querySelectorAll("a[href]"))
    .map((anchor) => anchor.href)
    .filter((href) => href.startsWith("https://") || href.startsWith("http://"));
  return {
    url: location.href,
    title: clean(document.title) || location.hostname,
    description,
    headings,
    navigation: [...new Set(navigation)],
    links: [...new Set(links)].slice(0, 80),
  };
}`;

export class WebsiteCaptureError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "WebsiteCaptureError";
    this.code = code;
  }
}

export async function captureIsolatedWebsite(options: {
  db: Pool;
  storage: StorageProvider;
  storageRoot: string;
  webOrigin: string;
  task: CaptureTask;
  onProgress: CaptureProgress;
}): Promise<WebsiteCaptureResult> {
  const startUrl = await validatePublicHttpUrl(options.task.start_url);
  const tempDir = await mkdtemp(join(tmpdir(), `helstera-capture-${options.task.id}-`));
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  let videoPath: string | undefined;

  try {
    await options.onProgress(5, "browser_starting", "Starting a temporary browser");
    const executablePath = process.env.HELSTERA_PLAYWRIGHT_EXECUTABLE_PATH?.trim();
    browser = await chromium.launch({
      headless: true,
      args: ["--disable-background-networking", "--disable-component-update", "--disable-sync"],
      ...(executablePath ? { executablePath } : {}),
    });
    const context = await browser.newContext({
      acceptDownloads: false,
      ignoreHTTPSErrors: false,
      permissions: [],
      serviceWorkers: "block",
      ...(options.task.record_video
        ? { recordVideo: { dir: tempDir, size: { width: 1280, height: 720 } } }
        : {}),
      viewport: { width: 1280, height: 720 },
    });
    await context.routeWebSocket("**/*", blockIsolatedWebSocket);
    let transferredBytes = 0;
    let requestCount = 0;

    await context.route("**/*", async (route) => {
      requestCount += 1;
      if (requestCount > 180) {
        await route.abort("blockedbyclient");
        return;
      }
      const responseBytes = await fulfillPublicReadOnlyRequest(route);
      transferredBytes += responseBytes;
      if (transferredBytes > MAX_TOTAL_BYTES) {
        await route.abort("blockedbyclient");
      }
    });
    context.on("page", (page) => {
      if (page !== context.pages()[0]) void page.close();
    });
    const page = await context.newPage();
    page.setDefaultNavigationTimeout(PAGE_TIMEOUT_MS);
    page.setDefaultTimeout(PAGE_TIMEOUT_MS);

    const pending = [startUrl.toString()];
    const visited = new Set<string>();
    const captured: PageFacts[] = [];
    while (pending.length > 0 && captured.length < options.task.page_limit) {
      await assertTaskIsRunning(options.db, options.task.id);
      const nextUrl = pending.shift();
      if (!nextUrl || visited.has(nextUrl)) continue;
      visited.add(nextUrl);
      const percent = 10 + Math.round((captured.length / options.task.page_limit) * 62);
      await options.onProgress(percent, "page_loading", `Opening ${new URL(nextUrl).hostname}`);

      try {
        await page.goto(nextUrl, { waitUntil: "domcontentloaded" });
        await page.waitForTimeout(PAGE_SETTLE_MS);
        const facts = pageFactsSchema.parse(
          await page.evaluate(`(${PAGE_FACTS_SCRIPT})(${MAX_HEADINGS})`),
        );

        const responseUrl = await validatePublicHttpUrl(facts.url);
        const screenshot = await page.screenshot({ type: "jpeg", quality: 76, fullPage: false });
        captured.push({
          url: responseUrl.toString(),
          title: facts.title,
          description: facts.description,
          headings: facts.headings,
          navigation: facts.navigation,
          screenshot,
          width: 1280,
          height: 720,
        });

        for (const link of facts.links) {
          if (pending.length + captured.length >= options.task.page_limit * 3) break;
          const safeUrl = await validatePublicHttpUrl(link).catch(() => null);
          if (safeUrl && !options.task.follow_external && safeUrl.hostname !== startUrl.hostname) continue;
          if (safeUrl && !visited.has(safeUrl.toString()) && !pending.includes(safeUrl.toString())) {
            pending.push(safeUrl.toString());
          }
        }
      } catch (error) {
        if (captured.length === 0) throw toCaptureError(error);
      }
    }

    if (captured.length === 0) {
      throw new WebsiteCaptureError("no_pages_captured", "No pages could be captured from this website.");
    }
    await page.close();
    if (options.task.record_video) {
      const video = page.video();
      if (video) videoPath = await video.path();
    }
    await context.close();

    await options.onProgress(78, "saving_assets", "Saving screenshots and recording");
    const pages: WebsiteCapturePage[] = [];
    for (const [index, item] of captured.entries()) {
      await assertTaskIsRunning(options.db, options.task.id);
      const title = `Website screenshot ${index + 1}: ${item.title}`;
      const asset = await persistCaptureAsset({
        db: options.db,
        storage: options.storage,
        storageRoot: options.storageRoot,
        webOrigin: options.webOrigin,
        task: options.task,
        bytes: item.screenshot,
        mimeType: "image/jpeg",
        mediaType: "image",
        title,
        metadata: { sourceUrl: item.url, width: item.width, height: item.height },
      });
      pages.push({
        url: item.url,
        title: item.title,
        description: item.description,
        headings: item.headings,
        navigation: item.navigation,
        assetId: asset.id,
        screenshotUrl: asset.url,
      });
    }

    let recordingAssetId: string | undefined;
    let recordingUrl: string | undefined;
    if (videoPath) {
      const { readFile, stat } = await import("node:fs/promises");
      const videoInfo = await stat(videoPath);
      if (videoInfo.size > MAX_VIDEO_BYTES) {
        throw new WebsiteCaptureError("recording_too_large", "The browser recording exceeded the 40 MB limit.");
      }
      const video = await readFile(videoPath);
      const asset = await persistCaptureAsset({
        db: options.db,
        storage: options.storage,
        storageRoot: options.storageRoot,
        webOrigin: options.webOrigin,
        task: options.task,
        bytes: video,
        mimeType: "video/webm",
        mediaType: "video",
        title: `Website browsing recording: ${pages[0]?.title ?? startUrl.hostname}`,
        metadata: { sourceUrl: startUrl.toString(), pageCount: pages.length },
      });
      recordingAssetId = asset.id;
      recordingUrl = asset.url;
    }

    const title = pages[0]?.title || startUrl.hostname;
    const evidence = buildWebsiteEvidence(pages);
    const claims = buildWebsiteClaims(startUrl.toString(), pages);
    const introduction = buildWebsiteIntroduction(startUrl.toString(), pages, claims);
    await options.onProgress(96, "writing_report", "Preparing the sourced website introduction");
    return {
      title,
      introduction,
      startUrl: startUrl.toString(),
      pages,
      evidence,
      claims,
      ...(recordingAssetId ? { recordingAssetId } : {}),
      ...(recordingUrl ? { recordingUrl } : {}),
      completedAt: new Date().toISOString(),
    };
  } finally {
    await browser?.close().catch(() => undefined);
    await rm(tempDir, { recursive: true, force: true });
  }
}

export async function validatePublicHttpUrl(input: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new WebsiteCaptureError("invalid_url", "Enter a valid website address.");
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new WebsiteCaptureError("blocked_protocol", "Only HTTP and HTTPS websites can be opened.");
  }
  if (url.username || url.password) {
    throw new WebsiteCaptureError("url_credentials_blocked", "Remove credentials from the website address.");
  }
  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local") || hostname.endsWith(".internal")) {
    throw new WebsiteCaptureError("private_address_blocked", "Private and local network addresses are not available in isolated browser mode.");
  }
  const addresses = isIP(hostname)
    ? [{ address: hostname, family: isIP(hostname) }]
    : await lookup(hostname, { all: true, verbatim: true }).catch(() => []);
  if (addresses.length === 0 || addresses.some(({ address }) => !isPublicAddress(address))) {
    throw new WebsiteCaptureError("private_address_blocked", "This address does not resolve exclusively to public internet addresses.");
  }
  url.hash = "";
  return url;
}

export function isPublicAddress(address: string): boolean {
  const normalized = address.toLowerCase().split("%")[0] ?? address;
  if (normalized.startsWith("::ffff:")) {
    const mapped = normalized.slice(7);
    return isIP(mapped) === 4 && isPublicIpv4(mapped);
  }
  if (isIP(normalized) === 4) return isPublicIpv4(normalized);
  if (isIP(normalized) !== 6) return false;
  const value = ipv6ToBigInt(normalized);
  if (value === null) return false;
  const mappedV4 = ipv6PrefixValue(value, 96) === ipv6PrefixValue(ipv6ToBigInt("::ffff:0:0")!, 96);
  if (mappedV4) return isPublicIpv4(Number(value & 0xffff_ffffn).toString(16).padStart(8, "0").match(/.{2}/g)!.map((part) => Number.parseInt(part, 16)).join("."));
  if (
    value === 0n || value === 1n ||
    isInIpv6Range(value, "fc00::", 7) || isInIpv6Range(value, "fe80::", 10) ||
    isInIpv6Range(value, "2001::", 23) || isInIpv6Range(value, "2001:db8::", 32) ||
    isInIpv6Range(value, "2002::", 16) || isInIpv6Range(value, "3fff::", 20) ||
    isInIpv6Range(value, "64:ff9b::", 96) || isInIpv6Range(value, "64:ff9b:1::", 48)
  ) return false;
  return isInIpv6Range(value, "2000::", 3);
}

export async function blockIsolatedWebSocket(route: WebSocketRoute): Promise<void> {
  await route.close({ code: 1008, reason: "WebSocket access is disabled in isolated capture." });
}

export function buildWebsiteEvidence(pages: WebsiteCapturePage[]): WebsiteCaptureEvidence[] {
  return pages.flatMap((page) => [
    { url: page.url, pageTitle: page.title, kind: "title" as const, excerpt: page.title },
    ...(page.description ? [{ url: page.url, pageTitle: page.title, kind: "description" as const, excerpt: page.description }] : []),
    ...page.headings.slice(0, 8).map((heading) => ({ url: page.url, pageTitle: page.title, kind: "heading" as const, excerpt: heading })),
    ...page.navigation.slice(0, 8).map((label) => ({ url: page.url, pageTitle: page.title, kind: "navigation" as const, excerpt: label })),
  ]).slice(0, 128);
}

export function buildWebsiteClaims(startUrl: string, pages: WebsiteCapturePage[]): WebsiteCaptureClaim[] {
  const root = pages[0];
  if (!root) return [{ text: "无法从页面证据确认网站定位、功能或用户路径。", sourceUrls: [], status: "unverified" }];
  const navigation = [...new Set(pages.flatMap((page) => page.navigation))].slice(0, 12);
  return [
    {
      text: root.description || root.title || new URL(startUrl).hostname,
      sourceUrls: [root.url],
      status: "observed",
    },
    {
      text: `已读取 ${pages.length} 个页面，页面标题和摘要如下所列。`,
      sourceUrls: pages.map((page) => page.url),
      status: "observed",
    },
    {
      text: navigation.length ? `主导航可能体现以下用户路径：${navigation.join("、")}。` : "未读取到足够主导航，无法推断用户路径。",
      sourceUrls: pages.filter((page) => page.navigation.length > 0).map((page) => page.url),
      status: navigation.length ? "inferred" : "unverified",
    },
    {
      text: "登录后功能、后台能力、业务真实性和未读取页面内容无法通过本次公开页面证据验证。",
      sourceUrls: [],
      status: "unverified",
    },
  ];
}

export function buildWebsiteIntroduction(startUrl: string, pages: WebsiteCapturePage[], claims = buildWebsiteClaims(startUrl, pages)): string {
  const root = pages[0];
  const siteName = root?.title || new URL(startUrl).hostname;
  const description = root?.description || root?.headings.slice(0, 3).join("、") || "页面未提供可读取的站点简介";
  const pageList = pages.map((page) => `- [${page.title}](${page.url})：${page.description || page.headings.slice(0, 4).join("、") || "页面摘要未提供"}`).join("\n");
  const navigation = [...new Set(pages.flatMap((page) => page.navigation))].slice(0, 12);
  const claimList = claims.map((claim) => {
    const source = claim.sourceUrls.length ? `来源：${claim.sourceUrls.map((url) => `[页面](${url})`).join("、")}` : "无可用来源页面";
    const label = claim.status === "observed" ? "已观测" : claim.status === "inferred" ? "推断" : "无法验证";
    return `- **${label}**：${claim.text}（${source}）`;
  }).join("\n");
  return [
    `## ${siteName}`,
    "",
    `**网站定位**：${description}（依据首页可见描述与标题提取，未验证页面之外的业务事实。）`,
    "",
    "**主要页面**：",
    pageList,
    "",
    `**导航线索**：${navigation.length ? navigation.join("、") : "页面未提供可识别的主导航"}。`,
    "",
    "**结论与证据边界**：",
    claimList,
    "",
    `**访问入口**：${startUrl}`,
  ].join("\n");
}

async function fulfillPublicReadOnlyRequest(route: Route): Promise<number> {
  const request = route.request();
  const method = request.method().toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    await route.abort("blockedbyclient");
    return 0;
  }

  const parsedUrl = await validatePublicHttpUrl(request.url()).catch(() => null);
  if (!parsedUrl) {
    await route.abort("blockedbyclient");
    return 0;
  }

  const hostname = parsedUrl.hostname;
  const pinnedAddress = await resolvePublicAddress(hostname).catch(() => null);
  if (!pinnedAddress) {
    await route.abort("blockedbyclient");
    return 0;
  }

  const dispatcher = new Agent({
    connect: {
      lookup: ((
        _host: string,
        lookupOptions: unknown,
        callback: (...args: unknown[]) => void,
      ) => {
        const resolved = { address: pinnedAddress.address, family: pinnedAddress.family };
        const all = typeof lookupOptions === "object" && lookupOptions !== null && "all" in lookupOptions && lookupOptions.all === true;
        if (all) callback(null, [resolved]);
        else callback(null, resolved.address, resolved.family);
      }) as never,
    },
  });

  try {
    const response = await httpRequest(parsedUrl, {
      dispatcher,
      method,
      headersTimeout: PAGE_TIMEOUT_MS,
      bodyTimeout: PAGE_TIMEOUT_MS,
      headers: {
        accept: request.headers().accept ?? "text/html,application/xhtml+xml,image/avif,image/webp,*/*;q=0.8",
        "accept-language": request.headers()["accept-language"] ?? "zh-CN,zh;q=0.9,en;q=0.8",
        "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/132 Safari/537.36 HelsteraCapture/1.0",
      },
    });
    const headers = selectResponseHeaders(response.headers as Record<string, string | string[] | undefined>);
    if (method === "HEAD" || response.statusCode === 204 || response.statusCode === 304 || (response.statusCode >= 300 && response.statusCode < 400)) {
      await route.fulfill({ status: response.statusCode, headers, body: Buffer.alloc(0) });
      abortResponseBody(response.body);
      return 0;
    }

    const declaredLength = Number(response.headers["content-length"] ?? 0);
    if (declaredLength > MAX_RESPONSE_BYTES) {
      abortResponseBody(response.body);
      await route.abort("blockedbyclient");
      return 0;
    }
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of response.body) {
      const part = Buffer.from(chunk);
      total += part.length;
      if (total > MAX_RESPONSE_BYTES) {
        abortResponseBody(response.body);
        await route.abort("blockedbyclient");
        return 0;
      }
      chunks.push(part);
    }
    const body = Buffer.concat(chunks, total);
    await route.fulfill({ status: response.statusCode, headers, body });
    return total;
  } catch (error) {
    console.warn("[website-capture] public request blocked", {
      host: parsedUrl.hostname,
      reason: error instanceof Error ? error.message.slice(0, 240) : String(error).slice(0, 240),
    });
    await route.abort("failed").catch(() => undefined);
    return 0;
  } finally {
    await dispatcher.close();
  }
}

function abortResponseBody(body: NodeJS.ReadableStream) {
  body.once("error", () => undefined);
  if ("destroy" in body && typeof body.destroy === "function") {
    body.destroy();
  }
}

async function resolvePublicAddress(hostname: string) {
  const records = isIP(hostname)
    ? [{ address: hostname, family: isIP(hostname) }]
    : await lookup(hostname, { all: true, verbatim: true });
  if (records.length === 0 || records.some(({ address }) => !isPublicAddress(address))) return null;
  return records[0]!;
}

function isPublicIpv4(address: string) {
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b, c] = octets as [number, number, number, number];
  return !(
    a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && ((b === 0 && (c === 0 || c === 2)) || b === 168)) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113) ||
    (a === 192 && b === 88 && c === 99)
  );
}

function ipv6ToBigInt(address: string): bigint | null {
  let normalized = address.toLowerCase();
  if (normalized.includes(".")) {
    const lastColon = normalized.lastIndexOf(":");
    const ipv4 = normalized.slice(lastColon + 1).split(".").map(Number);
    if (ipv4.length !== 4 || ipv4.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
    const high = ((ipv4[0]! << 8) | ipv4[1]!).toString(16);
    const low = ((ipv4[2]! << 8) | ipv4[3]!).toString(16);
    normalized = `${normalized.slice(0, lastColon)}:${high}:${low}`;
  }
  const halves = normalized.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves[1] ? halves[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) return null;
  const groups = [...left, ...Array.from({ length: halves.length === 2 ? missing : 0 }, () => "0"), ...right];
  if (groups.length !== 8 || groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return null;
  return groups.reduce((value, group) => (value << 16n) | BigInt(`0x${group}`), 0n);
}

function ipv6PrefixValue(value: bigint, prefixLength: number) {
  return value >> BigInt(128 - prefixLength);
}

function isInIpv6Range(value: bigint, prefix: string, prefixLength: number) {
  const prefixValue = ipv6ToBigInt(prefix);
  return prefixValue !== null && ipv6PrefixValue(value, prefixLength) === ipv6PrefixValue(prefixValue, prefixLength);
}

function selectResponseHeaders(input: Record<string, string | string[] | undefined>): Record<string, string> {
  const allowed = new Set([
    "content-type", "content-language", "content-encoding", "content-length", "content-range",
    "cache-control", "expires", "last-modified", "etag", "location", "accept-ranges",
  ]);
  return Object.fromEntries(Object.entries(input)
    .filter(([key, value]) => allowed.has(key.toLowerCase()) && typeof value === "string")
    .map(([key, value]) => [key.toLowerCase(), value as string]));
}

export async function persistCaptureAsset(input: {
  db: Pool;
  storage: StorageProvider;
  storageRoot: string;
  webOrigin: string;
  task: CaptureTask;
  bytes: Buffer;
  mimeType: string;
  mediaType: "image" | "video";
  title: string;
  metadata: Record<string, unknown>;
}) {
  const extension = input.mimeType === "video/webm" ? "webm" : "jpg";
  const objectPath = `${input.task.workspace_id}/generated/website-capture/${input.task.id}/${randomUUID()}.${extension}`;
  const upload = await input.storage.upload("project-assets", objectPath, input.bytes, {
    contentType: input.mimeType,
    upsert: false,
  });
  if (upload.error) throw new Error(`Could not save capture asset: ${upload.error.message}`);

  let client: PoolClient | undefined;
  try {
    client = await input.db.connect();
    await client.query("begin");
    const asset = await client.query<{ id: string }>(
      `insert into asset_objects(workspace_id, bucket, object_path, mime_type, byte_size, created_by)
       values($1, 'project-assets', $2, $3, $4, $5) returning id`,
      [input.task.workspace_id, objectPath, input.mimeType, input.bytes.length, input.task.created_by],
    );
    const assetId = asset.rows[0]?.id;
    if (!assetId) throw new Error("Asset metadata could not be saved.");
    await client.query(
      `insert into generated_assets(workspace_id, created_by, media_type, object_path, mime_type, title, description, prompt, metadata, website_capture_task_id)
       values($1, $2, $3, $4, $5, $6, $7, '', $8::jsonb, $9)`,
      [input.task.workspace_id, input.task.created_by, input.mediaType, objectPath, input.mimeType, input.title, "Captured from a website selected by the workspace user.", JSON.stringify(input.metadata), input.task.id],
    );
    await client.query("commit");
    return { id: assetId, url: `${input.webOrigin}/api/uploads/${assetId}/file` };
  } catch (error) {
    await client?.query("rollback").catch(() => undefined);
    await input.storage.remove("project-assets", [objectPath]).catch(() => undefined);
    throw error;
  } finally {
    client?.release();
  }
}

async function assertTaskIsRunning(db: Pool, taskId: string) {
  const { rows } = await db.query<{ status: string }>("select status from website_capture_tasks where id=$1", [taskId]);
  if (rows[0]?.status === "canceled") {
    throw new WebsiteCaptureError("job_canceled", "Website capture was canceled by the user.");
  }
  if (rows[0]?.status !== "running") {
    throw new WebsiteCaptureError("task_unavailable", "Website capture is no longer active.");
  }
}

function buildWebsiteIntroductionFallback(startUrl: string, pages: WebsiteCapturePage[]): string {
  const root = pages[0];
  const siteName = root?.title || new URL(startUrl).hostname;
  const description = root?.description || root?.headings.slice(0, 3).join("、") || "页面未提供可读取的站点简介";
  const pageList = pages.map((page) => `- [${page.title}](${page.url})：${page.description || page.headings.slice(0, 4).join("、") || "页面摘要未提供"}`).join("\n");
  const navigation = [...new Set(pages.flatMap((page) => page.navigation))].slice(0, 12);
  return [
    `## ${siteName}`,
    "",
    `**网站定位**：${description}（依据页面公开标题与描述提取，未验证页面之外的业务事实。）`,
    "",
    "**主要页面**：",
    pageList,
    "",
    `**导航线索**：${navigation.length ? navigation.join("、") : "页面未提供可识别的主导航"}。`,
    "",
    `**访问入口**：${startUrl}`,
  ].join("\n");
}

function toCaptureError(error: unknown): WebsiteCaptureError {
  if (error instanceof WebsiteCaptureError) return error;
  const message = error instanceof Error ? error.message : "The website could not be opened.";
  return new WebsiteCaptureError("browser_navigation_failed", message.slice(0, 500));
}
