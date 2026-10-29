"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Download, MonitorDown, RefreshCw } from "lucide-react";

import { DesktopEmptyState } from "@/components/desktop-empty-state";
import { useDesktopToast } from "@/components/desktop-toast";
import {
  formatDesktopCopy,
  useDesktopCopy,
  type DesktopCopy,
  type DesktopLocale,
} from "@/lib/desktop-copy";

const PLATFORMS = [
  { id: "windows-x64", architecture: "x64", icon: Download },
  { id: "linux-x64", architecture: "x64", icon: MonitorDown },
  { id: "macos-arm64", architecture: "Apple Silicon", icon: Download },
  { id: "macos-x64", architecture: "Intel", icon: Download },
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

async function fetchRelease(platform: PlatformId, copy: DesktopCopy): Promise<DesktopReleaseManifest | null> {
  const response = await fetch(`/downloads/desktop-release-${platform}.json`, { cache: "no-store" });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(copy.downloads.releaseUnavailable);
  const payload: unknown = await response.json();
  if (!isReleaseManifest(payload, platform)) throw new Error(copy.downloads.manifestInvalid);
  return payload;
}

export function DesktopDownloadList({ locale }: { locale?: DesktopLocale | null } = {}) {
  const { copy } = useDesktopCopy(locale);
  const toast = useDesktopToast();
  const [releases, setReleases] = useState<Partial<Record<PlatformId, DesktopReleaseManifest>>>({});
  const [failedPlatforms, setFailedPlatforms] = useState<PlatformId[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const hasLoaded = useRef(false);

  const loadReleases = useCallback(async () => {
    setLoading(true);
    setError(null);
    const results = await Promise.allSettled(PLATFORMS.map(async ({ id }) => ({ id, manifest: await fetchRelease(id, copy) })));
    const next: Partial<Record<PlatformId, DesktopReleaseManifest>> = {};
    const failed: PlatformId[] = [];
    // The rejection reason used to be thrown away, so a broken manifest read looked
    // identical to "not published yet". Keep the reason and say it out loud.
    const reasons = new Set<string>();
    for (const [index, result] of results.entries()) {
      if (result.status === "rejected") {
        failed.push(PLATFORMS[index]!.id);
        const reason = result.reason instanceof Error ? result.reason.message.trim() : "";
        reasons.add(reason || copy.downloads.releaseUnavailable);
        continue;
      }
      if (result.value.manifest) next[result.value.id] = result.value.manifest;
    }
    setReleases((current) => ({ ...current, ...next }));
    setFailedPlatforms(failed);
    const reasonText = [...reasons].join(copy.downloads.reasonSeparator);
    const allFailed = failed.length === PLATFORMS.length;
    setError(allFailed
      ? reasonText
        ? formatDesktopCopy(copy.downloads.allFailedWithReason, { reason: reasonText })
        : copy.downloads.allFailed
      : null);
    setLoading(false);

    if (failed.length > 0) {
      const scope = allFailed
        ? copy.downloads.toastAllFailed
        : formatDesktopCopy(copy.downloads.toastPartialFailed, { failed: failed.length, total: PLATFORMS.length });
      toast.push({ tone: "error", message: formatDesktopCopy(copy.downloads.toastFailed, { scope, reason: reasonText }), key: `download:list-failed:${reasonText}` });
    } else if (hasLoaded.current) {
      toast.push({
        tone: "success",
        message: formatDesktopCopy(copy.downloads.toastRefreshed, { count: Object.keys(next).length }),
        key: "download:list-refreshed",
      });
    }
    hasLoaded.current = true;
  }, [copy, toast]);

  useEffect(() => {
    void loadReleases();
  }, [loadReleases]);

  return (
    <section aria-labelledby="desktop-platforms-title" className="mt-9">
      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <h2 id="desktop-platforms-title" className="text-sm font-semibold">{copy.downloads.title}</h2>
          <p className="mt-1 text-xs text-muted-foreground">{copy.downloads.subtitle}</p>
        </div>
        {error ? (
          <button type="button" onClick={() => void loadReleases()} aria-label={copy.downloads.rereadAria} className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border/60 text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <RefreshCw className="size-4" aria-hidden="true" />
          </button>
        ) : null}
      </div>

      {!loading && !error && Object.keys(releases).length === 0 ? (
        <DesktopEmptyState
          icon={Download}
          title={copy.downloads.emptyTitle}
          description={copy.downloads.emptyBody}
          action={
            <button
              type="button"
              onClick={() => void loadReleases()}
              className="rounded-md border border-border/60 px-3 py-1.5 text-xs font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {copy.downloads.reread}
            </button>
          }
        />
      ) : (
        <div className="grid gap-2">
          {PLATFORMS.map((platform) => {
            const release = releases[platform.id];
            const failed = failedPlatforms.includes(platform.id);
            const isPortableWindows = platform.id === "windows-x64" && Boolean(release?.portableFileName);
            const fileName = release ? (isPortableWindows ? release.portableFileName ?? release.fileName : release.fileName) : null;
            const PlatformIcon = platform.icon;
            const label = copy.downloads.platformLabels[platform.id] ?? platform.id;
            const cardClass = "group flex min-h-[76px] items-center gap-4 rounded-lg border border-border/70 bg-background px-4 py-3 text-left transition-colors hover:border-foreground/30 hover:bg-muted/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";
            const details = (
              <>
                <span className={`flex size-10 shrink-0 items-center justify-center rounded-lg ${isPortableWindows ? "bg-emerald-700 text-white" : "bg-muted text-foreground"}`}>
                  <PlatformIcon className="size-[18px]" aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-semibold">
                    {label}
                    {isPortableWindows ? <span className="rounded-sm bg-emerald-700/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-800">{copy.downloads.portableBadge}</span> : null}
                  </span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    {loading ? copy.downloads.readingVersion : release ? `${platform.architecture} · v${release.version}` : failed ? copy.downloads.versionUnavailable : copy.downloads.notPublished}
                  </span>
                </span>
                <span className="hidden shrink-0 items-center gap-1.5 text-xs font-medium text-foreground sm:inline-flex">
                  {release ? copy.downloads.download : failed ? copy.downloads.retry : loading ? copy.downloads.reading : copy.downloads.unpublished}
                  {release ? <Download className="size-3.5" aria-hidden="true" /> : failed ? <RefreshCw className="size-3.5" aria-hidden="true" /> : null}
                </span>
              </>
            );
  
            return release && fileName ? (
              <a
                key={platform.id}
                href={`/downloads/${encodeURIComponent(fileName)}`}
                download
                className={cardClass}
                onClick={() => toast.push({
                  tone: "info",
                  message: formatDesktopCopy(copy.downloads.startDownload, {
                    label,
                    suffix: isPortableWindows
                      ? copy.downloads.portableSuffix
                      : formatDesktopCopy(copy.downloads.architectureSuffix, { architecture: platform.architecture }),
                  }),
                  key: `download:start:${platform.id}`,
                })}
              >
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
      )}

      <p role={error ? "alert" : "status"} className="mt-3 min-h-5 border-t border-border/60 pt-3 text-xs text-muted-foreground">
        {error ?? (loading ? copy.downloads.footerLoading : copy.downloads.footerHint)}
      </p>
    </section>
  );
}
