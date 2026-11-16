"use client";

import {
  type GalleryCaptionInput,
  MAX_GALLERY_CAPTION_BYTES,
  parseGalleryCaptions,
} from "@helstera/shared";
import { type ChangeEvent, useEffect, useRef, useState } from "react";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "./ui/dialog";

export function PublishAssetDialog({
  title,
  video,
  busy,
  onConfirm,
  onCancel,
}: {
  title: string;
  video: boolean;
  busy: boolean;
  onConfirm(caption?: GalleryCaptionInput): Promise<void>;
  onCancel(): void;
}) {
  const [includeCaption, setIncludeCaption] = useState(false);
  const [source, setSource] = useState("");
  const [language, setLanguage] = useState("zh");
  const [label, setLabel] = useState("中文字幕");
  const [reading, setReading] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const readVersion = useRef(0);
  const locked = useRef(false);
  useEffect(
    () => () => {
      readVersion.current += 1;
    },
    [],
  );

  let preview: ReturnType<typeof parseGalleryCaptions> | null = null;
  let parseError = "";
  if (source) {
    try {
      preview = parseGalleryCaptions({
        vtt: source,
        language,
        label,
        consent: true,
      });
    } catch (cause) {
      parseError = cause instanceof Error ? cause.message : "字幕格式无效。";
    }
  }

  async function chooseCaption(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    const version = ++readVersion.current;
    setError("");
    setSource("");
    setReading(false);
    if (!file) return;
    if (
      !file.name.toLowerCase().endsWith(".vtt") ||
      file.size > MAX_GALLERY_CAPTION_BYTES
    ) {
      setError("请选择不超过 256 KB 的 .vtt 字幕文件。");
      return;
    }
    setReading(true);
    try {
      const text = await file.text();
      if (version === readVersion.current) setSource(text);
    } catch {
      if (version === readVersion.current)
        setError("字幕文件读取失败，请重新选择。");
    } finally {
      if (version === readVersion.current) setReading(false);
    }
  }

  async function confirmPublication() {
    if (locked.current || busy || reading) return;
    if (includeCaption && !preview) {
      setError(parseError || "请先选择并检查字幕文件。");
      return;
    }
    locked.current = true;
    setSubmitting(true);
    setError("");
    try {
      await onConfirm(
        includeCaption
          ? { vtt: source, language, label, consent: true }
          : undefined,
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "公开作品失败，所选内容仍保留，请重试。",
      );
    } finally {
      locked.current = false;
      setSubmitting(false);
    }
  }

  const pending = busy || submitting;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onCancel();
      }}
    >
      <DialogContent
        className="max-h-[85dvh] overflow-y-auto sm:max-w-xl"
        showCloseButton={false}
      >
        <DialogTitle>公开作品：{title}</DialogTitle>
        <DialogDescription>
          作品媒体、标题、作者和生成信息会展示在公共作品库。取消公开后，新请求将不能读取；已下载的内容无法收回。
        </DialogDescription>
        {video ? (
          <div className="space-y-3 rounded-lg border p-3">
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={includeCaption}
                onChange={(event) => setIncludeCaption(event.target.checked)}
                disabled={pending}
              />
              同时公开我选择的字幕
            </label>
            <p className="text-xs text-muted-foreground">
              字幕为可选项。不会自动读取或公开你的私人转写，请确认时间与这段成片一致。
            </p>
            {includeCaption ? (
              <>
                <label className="block text-sm">
                  字幕文件（WebVTT）
                  <input
                    type="file"
                    accept=".vtt,text/vtt"
                    onChange={chooseCaption}
                    disabled={pending}
                    className="mt-1 block w-full rounded border p-2 text-sm"
                  />
                </label>
                <label className="block text-sm">
                  字幕语言
                  <select
                    value={language}
                    onChange={(event) => setLanguage(event.target.value)}
                    disabled={pending}
                    className="mt-1 block w-full rounded border bg-background p-2"
                  >
                    <option value="zh">中文</option>
                    <option value="en">English</option>
                    <option value="ja">日本語</option>
                    <option value="ko">한국어</option>
                    <option value="fr">Français</option>
                    <option value="de">Deutsch</option>
                    <option value="es">Español</option>
                    <option value="und">未确定语言</option>
                  </select>
                </label>
                <label className="block text-sm">
                  播放器字幕名称
                  <input
                    value={label}
                    maxLength={60}
                    onChange={(event) => setLabel(event.target.value)}
                    disabled={pending}
                    className="mt-1 block w-full rounded border bg-background p-2"
                  />
                </label>
                {reading ? (
                  <output className="block text-sm">正在读取字幕…</output>
                ) : null}
                {preview ? (
                  <section
                    aria-label="将公开的字幕预览"
                    className="max-h-52 overflow-auto rounded bg-muted p-3 text-sm"
                  >
                    <p>
                      {preview.cues.length} 段 · 最后时间{" "}
                      {((preview.cues.at(-1)?.endMs ?? 0) / 1000).toFixed(2)} 秒
                    </p>
                    {preview.cues.map((cue, index) => (
                      <p
                        key={`${cue.startMs}:${index}`}
                        className="mt-2 whitespace-pre-wrap break-words"
                      >
                        <span className="text-xs text-muted-foreground">
                          {(cue.startMs / 1000).toFixed(2)}–
                          {(cue.endMs / 1000).toFixed(2)} 秒
                        </span>
                        <br />
                        {cue.text}
                      </p>
                    ))}
                  </section>
                ) : null}
                {parseError ? (
                  <p role="alert" className="text-sm text-destructive">
                    {parseError}
                  </p>
                ) : null}
              </>
            ) : null}
          </div>
        ) : null}
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel} disabled={pending}>
            取消
          </Button>
          <Button
            onClick={confirmPublication}
            disabled={pending || reading || (includeCaption && !preview)}
          >
            {pending
              ? "正在公开…"
              : includeCaption
                ? "确认公开作品和字幕"
                : "确认公开作品"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
