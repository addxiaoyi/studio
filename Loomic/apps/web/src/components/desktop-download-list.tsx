"use client";

import { useCallback, useEffect, useState } from "react";
import { Download, MonitorDown, RefreshCw } from "lucide-react";

const PLATFORMS = [
  { id: "windows-x64", label: "Windows 便携包", architecture: "x64", icon: Download },
  { id: "linux-x64", label: "Linux AppImage", architecture: "x64", icon: MonitorDown },
  { id: "macos-arm64", label: "macOS 安装包", architecture: "Apple Silicon", icon: Download },
  { id: "macos-x64", label: "macOS 安装包", architecture: "Intel", icon: Download },
] as const;

type PlatformId = (typeof PLATFORMS)[number]["id"];

type DesktopReleaseManifest = {
  platform: PlatformId;
  version: string;
  fileName: string;
  sha256: string;
  portableFileName?: string;
  portableSha256?: string;
  publishedAt: string;
};

function isReleaseManifest(value: unknown, expectedPlatform: PlatformId): value is DesktopReleaseManifest {
  if (!value || typeof value !== "object") return false;
  const manifest = value as Record<string, unknown>;
  return manifest.platform === expectedPlatform
    && typeof manifest.version === "string"
    && /^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(manifest.version)
    && typeof manifest.fileName === "string"
    && /^[A-Za-z0-9._-]+$/.test(manifest.fileName)
    && typeof manifest.sha256 === "string"
    && /^[a-f0-9]{64}$/i.test(manifest.sha256)
    && (manifest.portableFileName === undefined || (typeof manifest.portableFileName === "string" && /^[A-Za-z0-9._-]+$/.test(manifest.portableFileName)))
    && (manifest.portableSha256 === undefined || (typeof manifest.portableSha256 === "string" && /^[a-f0-9]{64}$/i.test(manifest.portableSha256)))
    && typeof manifest.publishedAt === "string"
    && Number.isFinite(Date.parse(manifest.publishedAt));
}

async function fetchRelease(platform: PlatformId): Promise<DesktopReleaseManifest | null> {
  const response = await fetch(`/downloads/desktop-release-${platform}.json`, { cache: "no-store" });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error("版本信息暂时无法获取");
  const payload: unknown = await response.json();
  if (!isReleaseManifest(payload, platform)) throw new Error("下载清单格式无效");
  return payload;
}

export function DesktopDownloadList() {
  const [releases, setReleases] = useState<Partial<Record<PlatformId, DesktopReleaseManifest>>>({});
  const [failedPlatforms, setFailedPlatforms] = useState<PlatformId[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadReleases = useCallback(async () => {
    setLoading(true);
    setError(null);
    const results = await Promise.allSettled(PLATFORMS.map(async ({ id }) => ({ id, manifest: await fetchRelease(id) })));
    const next: Partial<Record<PlatformId, DesktopReleaseManifest>> = {};
    const failed: PlatformId[] = [];
    for (const [index, result] of results.entries()) {
      if (result.status === "rejected") {
        failed.push(PLATFORMS[index]!.id);
        continue;
      }
      if (result.value.manifest) next[result.value.id] = result.value.manifest;
    }
    setReleases((current) => ({ ...current, ...next }));
    setFailedPlatforms(failed);
    setError(failed.length === PLATFORMS.length ? "暂时无法读取发布清单，请稍后重试。" : null);
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadReleases();
  }, [loadReleases]);

  return (
    <section aria-labelledby="desktop-platforms-title" className="mt-9">
      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <h2 id="desktop-platforms-title" className="text-sm font-semibold">可用平台</h2>
          <p className="mt-1 text-xs text-muted-foreground">版本与下载文件来自 Helstera 发布清单</p>
        </div>
        {error ? (
          <button type="button" onClick={() => void loadReleases()} aria-label="重新读取版本" className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border/60 text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <RefreshCw className="size-4" aria-hidden="true" />
          </button>
        ) : null}
      </div>

      <div className="grid gap-2">
        {PLATFORMS.map((platform) => {
          const release = releases[platform.id];
          const failed = failedPlatforms.includes(platform.id);
          const isPortableWindows = platform.id === "windows-x64" && Boolean(release?.portableFileName);
          const fileName = release ? (isPortableWindows ? release.portableFileName ?? release.fileName : release.fileName) : null;
          const PlatformIcon = platform.icon;
          const cardClass = "group flex min-h-[76px] items-center gap-4 rounded-lg border border-border/70 bg-background px-4 py-3 text-left transition-colors hover:border-foreground/30 hover:bg-muted/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";
          const details = (
            <>
              <span className={`flex size-10 shrink-0 items-center justify-center rounded-lg ${isPortableWindows ? "bg-emerald-700 text-white" : "bg-muted text-foreground"}`}>
                <PlatformIcon className="size-[18px]" aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-semibold">
                  {platform.label}
                  {isPortableWindows ? <span className="rounded-sm bg-emerald-700/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-800">免安装</span> : null}
                </span>
                <span className="mt-1 block text-xs text-muted-foreground">
                  {loading ? "正在读取版本…" : release ? `${platform.architecture} · v${release.version}` : failed ? "版本信息暂不可用" : "尚未发布"}
                </span>
              </span>
              <span className="hidden shrink-0 items-center gap-1.5 text-xs font-medium text-foreground sm:inline-flex">
                {release ? "下载" : failed ? "重试" : loading ? "读取中" : "未发布"}
                {release ? <Download className="size-3.5" aria-hidden="true" /> : failed ? <RefreshCw className="size-3.5" aria-hidden="true" /> : null}
              </span>
            </>
          );

          return release && fileName ? (
            <a key={platform.id} href={`/downloads/${encodeURIComponent(fileName)}`} download className={cardClass}>
              {details}
              <span className="sr-only">SHA-256 {isPortableWindows ? release.portableSha256 ?? release.sha256 : release.sha256}</span>
            </a>
          ) : (
            <button key={platform.id} type="button" disabled={!failed} onClick={() => void loadReleases()} aria-busy={loading} className={`${cardClass} w-full opacity-75 disabled:cursor-default`}>
              {details}
            </button>
          );
        })}
      </div>

      <p role={error ? "alert" : "status"} className="mt-3 min-h-5 border-t border-border/60 pt-3 text-xs text-muted-foreground">
        {error ?? (loading ? "正在读取 Helstera 发布清单…" : "Windows 便携包解压后启动；登录和助手数据保存在本机用户目录。")}
      </p>
    </section>
  );
}
