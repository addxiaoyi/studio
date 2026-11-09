"use client";
import { useEffect, useState } from "react";
import { fetchCanvas } from "@/lib/server-api";
import {
  readCanvasTimeline,
  validateCanvasTimeline,
  type CanvasTimeline,
} from "@/lib/canvas-timeline";
import { readCanvasAsset } from "@/lib/canvas-media-file";
import { type StudioRuntime } from "@/lib/visualforge-runtime";
import { Button } from "./ui/button";

export function CanvasTimelineImport({
  runtime,
  token,
  onImported,
}: { runtime: StudioRuntime | null; token: string; onImported(): void }) {
  const [canvasId] = useState(() =>
    typeof location === "undefined"
      ? ""
      : (new URL(location.href).searchParams.get("timelineCanvas") ?? ""),
  );
  const [timeline, setTimeline] = useState<CanvasTimeline | null>(null),
    [error, setError] = useState("");
  const [busy, setBusy] = useState(false),
    [composition, setComposition] = useState(""),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!/^[a-f\d-]{36}$/i.test(canvasId)) return;
    let active = true;
    setBusy(true);
    setError("");
    void fetchCanvas(token, canvasId)
      .then(({ canvas }) => {
        const plan = readCanvasTimeline(
          canvas.content.elements,
          (
            canvas.content as {
              files?: Record<string, Record<string, unknown>>;
            }
          ).files ?? {},
          canvasId,
        );
        validateCanvasTimeline(plan);
        if (active) setTimeline(plan);
      })
      .catch((cause) => {
        if (active)
          setError(
            cause instanceof Error ? cause.message : "无法读取画布时间线。",
          );
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [canvasId, token, revision]);
  async function importTimeline() {
    if (!runtime || !timeline || busy) return;
    setBusy(true);
    setError("");
    try {
      if (!runtime.importCanvasTimeline)
        throw new Error("编辑器需要更新，请刷新后重试。");
      const fingerprint = [
        ...new Uint8Array(
          await crypto.subtle.digest(
            "SHA-256",
            new TextEncoder().encode(JSON.stringify(timeline)),
          ),
        ),
      ]
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
      const names: Record<string, string> = {};
      for (const item of timeline.items) {
        if (item.kind === "subtitle") continue;
        let file: File;
        if (item.assetId) {
          const saved = await runtime.readAsset(item.assetId);
          file =
            saved ??
            (
              await readCanvasAsset(
                token,
                item.assetId,
                new AbortController().signal,
              )
            ).file;
        } else {
          if (!item.dataUrl?.startsWith("data:image/"))
            throw new Error(`${item.title} 缺少图片文件。`);
          const blob = await (await fetch(item.dataUrl)).blob();
          file = new File(
            [blob],
            `canvas-${item.id}.${blob.type.split("/")[1]}`,
            { type: blob.type },
          );
        }
        if (item.assetId) {
          await runtime.importAsset(file, item.assetId);
          const imported = await runtime.readAsset(item.assetId);
          if (!imported) throw new Error(`${item.title} 未保存到工程。`);
          names[item.id] = imported.name;
        } else {
          const name = `canvas-${fingerprint.slice(0, 12)}-${item.id}.${file.name.split(".").pop()}`;
          if (!runtime.listMedia().some((media) => media.name === name))
            await runtime.importAsset(
              new File([file], name, { type: file.type }),
            );
          names[item.id] = name;
        }
      }
      setComposition(
        await runtime.importCanvasTimeline(timeline, names, fingerprint),
      );
      onImported();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "时间线导入失败，已导入素材保留，可重试。",
      );
    } finally {
      setBusy(false);
    }
  }
  function draftEdit() {
    window.dispatchEvent(
      new CustomEvent("loomic:video-draft", {
        detail:
          "检查当前画布成片的画面、字幕、配乐与节奏，先给出逐项修改方案，确认后执行。",
      }),
    );
  }
  if (!canvasId) return null;
  return (
    <section
      aria-label="画布时间线交接"
      className="flex flex-wrap items-center gap-3 border-b bg-muted/20 px-4 py-3 text-sm"
    >
      <div className="min-w-0 flex-1">
        <p className="font-medium">
          {composition ? "画布时间线已保存为独立合成" : "确认画布时间线"}
        </p>
        <p
          role={error ? "alert" : "status"}
          className={error ? "text-destructive" : "text-muted-foreground"}
        >
          {error ||
            (timeline
              ? `${timeline.items.length} 条轨道 · ${timeline.duration.toFixed(1)} 秒 · ${timeline.format === "portrait" ? "竖屏" : "横屏"}。确认后导入，原合成保留。`
              : "正在读取画布…")}
        </p>
      </div>
      {!composition && timeline && (
        <Button disabled={busy || !runtime} onClick={importTimeline}>
          {busy ? "正在导入并保存…" : "确认导入时间线"}
        </Button>
      )}
      {error && !timeline && (
        <Button
          variant="outline"
          onClick={() => setRevision((value) => value + 1)}
        >
          重新读取
        </Button>
      )}
      {composition && (
        <>
          <Button onClick={draftEdit}>让 AI 继续剪辑</Button>
          <Button variant="outline" onClick={() => runtime?.openExport()}>
            导出成片
          </Button>
        </>
      )}
      <a
        className="inline-flex min-h-9 items-center underline"
        href={`/canvas/?id=${encodeURIComponent(canvasId)}`}
      >
        返回原画布
      </a>
    </section>
  );
}
