"use client";

import type { TranscriptExportOptions } from "@helstera/shared";
import type { ChangeEvent } from "react";
import type { OneTakeCopy } from "@/lib/onetake-copy";

const field = "mt-1 w-full rounded-md border bg-background px-2 py-2 text-base sm:text-sm";
export function OneTakeExportOptions({ options, onChange, copy, burnAvailable, disabled }: { options: TranscriptExportOptions; onChange(options: TranscriptExportOptions): void; copy: OneTakeCopy; burnAvailable: boolean; disabled: boolean }) {
  const subtitle = options.subtitle;
  const changeSubtitle = (patch: Partial<typeof subtitle>) => {
    const next = { ...subtitle, ...patch };
    if (options.format === "avi" && next.enabled && next.mode === "soft") {
      onChange(burnAvailable ? { ...options, subtitle: { ...next, mode: "burn" } } : { ...options, format: "mp4", subtitle: next });
      return;
    }
    onChange({ ...options, subtitle: next });
  };
  const chooseFormat = (event: ChangeEvent<HTMLSelectElement>) => {
    const format = event.target.value as TranscriptExportOptions["format"];
    if (format === "avi" && subtitle.enabled && subtitle.mode === "soft") {
      if (burnAvailable) onChange({ ...options, format, subtitle: { ...subtitle, mode: "burn" } });
      return;
    }
    onChange({ ...options, format });
  };
  return <fieldset disabled={disabled} className="min-w-0 space-y-3 rounded-lg border p-3">
    <legend className="px-1 text-sm font-medium">{copy.options}</legend>
    <div className="grid grid-cols-1 gap-3 min-[500px]:grid-cols-3">
      <label className="text-sm">{copy.format}<select className={field} value={options.format} onChange={chooseFormat}>{["mp4", "mov", "avi"].map(format => <option key={format} value={format} disabled={format === "avi" && subtitle.enabled && !burnAvailable}>{format.toUpperCase()}</option>)}</select></label>
      <label className="text-sm">{copy.quality}<select className={field} value={options.quality} onChange={event => onChange({ ...options, quality: event.target.value as TranscriptExportOptions["quality"] })}>{(["low", "medium", "high"] as const).map(quality => <option key={quality} value={quality}>{copy[quality]}</option>)}</select></label>
      <label className="text-sm">{copy.aspect}<select className={field} value={options.aspect} onChange={event => onChange({ ...options, aspect: event.target.value as TranscriptExportOptions["aspect"] })}>{(["original", "portrait", "landscape"] as const).map(aspect => <option key={aspect} value={aspect}>{copy[aspect]}</option>)}</select></label>
    </div>
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={subtitle.enabled} onChange={event => changeSubtitle({ enabled: event.target.checked })} />{copy.subtitle}</label>
    {subtitle.enabled && <div className="grid grid-cols-1 gap-3 min-[500px]:grid-cols-3">
      <label className="text-sm">{copy.subtitleMode}<select className={field} value={subtitle.mode} onChange={event => changeSubtitle({ mode: event.target.value as "burn" | "soft" })}><option value="burn" disabled={!burnAvailable}>{copy.burn}</option><option value="soft" disabled={options.format === "avi"}>{copy.soft}</option></select></label>
      {subtitle.mode === "burn" && <>
        <label className="text-sm">{copy.font}<select className={field} value={subtitle.font} onChange={event => changeSubtitle({ font: event.target.value as typeof subtitle.font })}>{["Noto Sans CJK SC", "Microsoft YaHei", "Arial"].map(font => <option key={font}>{font}</option>)}</select></label>
        <label className="text-sm">{copy.fontSize}<input className={field} type="number" min={16} max={72} placeholder={copy.autoSize} value={subtitle.size ?? ""} onChange={event => changeSubtitle({ size: event.target.value === "" ? null : Number(event.target.value) })} /></label>
        <label className="text-sm">{copy.color}<input className={`${field} h-10`} type="color" value={subtitle.color} onChange={event => changeSubtitle({ color: event.target.value })} /></label>
        <label className="text-sm">{copy.outline}<input className={`${field} h-10`} type="color" value={subtitle.outlineColor} onChange={event => changeSubtitle({ outlineColor: event.target.value })} /></label>
        <label className="text-sm">{copy.outlineWidth}<input className={field} type="number" min={0} max={5} value={subtitle.outlineWidth} onChange={event => changeSubtitle({ outlineWidth: Number(event.target.value) })} /></label>
        <label className="text-sm">{copy.position}<select className={field} value={subtitle.position} onChange={event => changeSubtitle({ position: event.target.value as typeof subtitle.position })}>{(["top", "center", "bottom"] as const).map(position => <option key={position} value={position}>{copy[position]}</option>)}</select></label>
      </>}
    </div>}
  </fieldset>;
}
