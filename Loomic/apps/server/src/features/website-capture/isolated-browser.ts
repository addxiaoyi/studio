import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Agent, request as httpRequest } from "undici";
import { chromium, type Route } from "playwright";
import type { Pool } from "pg";
import type { StorageProvider } from "../../storage/storage-provider.js";
import type { WebsiteCapturePage, WebsiteCaptureResult } from "@helstera/shared";

const PAGE_TIMEOUT_MS = 15_000;
const PAGE_SETTLE_MS = 650;
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_BYTES = 32 * 1024 * 1024;
const MAX_VIDEO_BYTES = 40 * 1024 * 1024;
const MAX_HEADINGS = 16;

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
    browser = await chromium.launch({
      headless: true,
      args: ["--disable-background-networking", "--disable-component-update", "--disable-sync"],
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
        const facts = await page.evaluate((maxHeadings) => {
          type ElementLike = {
            textContent: string | null;
            getAttribute(name: string): string | null;
          };
          type AnchorLike = ElementLike & { href: string };
          const browser = globalThis as unknown as {
            document: {
              title: string;
              querySelector(selector: string): ElementLike | null;
              querySelectorAll(selector: string): ArrayLike<ElementLike | AnchorLike>;
            };
            location: { href: string; hostname: string };
          };
          const document = browser.document;
          const location = browser.location;
          const clean = (value: string | null | undefined) =>
            (value ?? "").replace(/\s+/g, " ").trim().slice(0, 500);
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
            .map((anchor) => (anchor as AnchorLike).href)
            .filter((href) => href.startsWith("https://") || href.startsWith("http://"));
          return {
            url: location.href,
            title: clean(document.title) || location.hostname,
            description,
            headings,
            navigation: [...new Set(navigation)],
            links: [...new Set(links)].slice(0, 80),
          };
        }, MAX_HEADINGS);

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
    const introduction = buildWebsiteIntroduction(startUrl.toString(), pages);
    await options.onProgress(96, "writing_report", "Preparing the sourced website introduction");
    return {
      title,
      introduction,
      startUrl: startUrl.toString(),
      pages,
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
  if (normalized === "::" || normalized === "::1" || normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe80:") || normalized.startsWith("2001:db8:")) return false;
  const groups = normalized.split(":");
  const firstGroup = Number.parseInt(groups[0] || "0", 16);
  return firstGroup >= 0x2000 && firstGroup <= 0x3fff;
}

export function buildWebsiteIntroduction(startUrl: string, pages: WebsiteCapturePage[]): string {
  const root = pages[0];
  const siteName = root?.title || new URL(startUrl).hostname;
  const description = root?.description || root?.headings.slice(0, 3).join("、") || "页面未提供可读取的站点简介";
  const pageList = pages.map((page) => `- [${page.title}](${page.url})：${page.description || page.headings.slice(0, 4).join("、") || "页面摘要未提供"}`).join("\n");
  const navigation = [...new Set(pages.flatMap((page) => page.navigation))].slice(0, 12);
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
        _options: unknown,
        callback: (error: Error | null, address: string, family: number) => void,
      ) => callback(null, pinnedAddress.address, pinnedAddress.family)) as never,
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
      response.body.destroy();
      return 0;
    }

    const declaredLength = Number(response.headers["content-length"] ?? 0);
    if (declaredLength > MAX_RESPONSE_BYTES) {
      response.body.destroy();
      await route.abort("blockedbyclient");
      return 0;
    }
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of response.body) {
      const part = Buffer.from(chunk);
      total += part.length;
      if (total > MAX_RESPONSE_BYTES) {
        response.body.destroy();
        await route.abort("blockedbyclient");
        return 0;
      }
      chunks.push(part);
    }
    const body = Buffer.concat(chunks, total);
    await route.fulfill({ status: response.statusCode, headers, body });
    return total;
  } catch {
    await route.abort("failed").catch(() => undefined);
    return 0;
  } finally {
    await dispatcher.close();
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
    (a === 192 && (b === 168 || (b === 0 && c === 0) || (b === 0 && c === 2))) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113) ||
    (a === 192 && b === 88 && c === 99)
  );
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

  try {
    const asset = await input.db.query<{ id: string }>(
      `insert into asset_objects(workspace_id, bucket, object_path, mime_type, byte_size, created_by)
       values($1, 'project-assets', $2, $3, $4, $5) returning id`,
      [input.task.workspace_id, objectPath, input.mimeType, input.bytes.length, input.task.created_by],
    );
    const assetId = asset.rows[0]?.id;
    if (!assetId) throw new Error("Asset metadata could not be saved.");
    await input.db.query(
      `insert into generated_assets(workspace_id, created_by, media_type, object_path, mime_type, title, description, prompt, metadata)
       values($1, $2, $3, $4, $5, $6, $7, '', $8::jsonb)`,
      [input.task.workspace_id, input.task.created_by, input.mediaType, objectPath, input.mimeType, input.title, "Captured from a website selected by the workspace user.", JSON.stringify(input.metadata)],
    );
    return { id: assetId, url: `${input.webOrigin}/api/uploads/${assetId}/file` };
  } catch (error) {
    await input.storage.remove("project-assets", [objectPath]);
    throw error;
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
