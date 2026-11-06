"use client";

import { useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import type { Transcript, TranscriptEdit } from "@helstera/shared";
import { Button } from "@/components/ui/button";
import type { OneTakeCopy } from "@/lib/onetake-copy";

const WORDS_PER_PAGE = 100;
export function TranscriptWords({ transcript, edit, onChange, seek, time, copy, disabled }: { transcript: Transcript; edit: TranscriptEdit; onChange(edit: TranscriptEdit): void; seek(seconds: number): void; time: number; copy: OneTakeCopy; disabled: boolean }) {
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [text, setText] = useState("");
  const correcting = useRef(false);
  const start = page * WORDS_PER_PAGE;
  const visible = transcript.words.slice(start, start + WORDS_PER_PAGE);
  const toggle = (index: number, checked: boolean) => {
    const next = new Set(selected); if (checked) next.add(index); else next.delete(index);
    setSelected(next); if (next.size === 1) setText(edit.words[[...next][0]!]!.text);
  };
  const mark = (deleted: boolean) => onChange({ ...edit, words: edit.words.map((word, index) => selected.has(index) ? { ...word, deleted } : word) });
  const correct = () => { if (selected.size !== 1 || !text.trim()) return; onChange({ ...edit, words: edit.words.map((word, index) => selected.has(index) ? { ...word, text: text.trim() } : word) }); };
  const selectPage = () => setSelected(new Set(visible.map((_, index) => start + index)));
  const clear = () => setSelected(new Set());
  const remove = () => mark(true);
  const restore = () => mark(false);
  const editWord = (event: MouseEvent<HTMLButtonElement>) => {
    const index = Number(event.currentTarget.dataset.word);
    setSelected(new Set([index])); setText(edit.words[index]!.text); correcting.current = true;
  };
  const wordKeys = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "Delete" && event.key !== "Backspace") return;
    event.preventDefault(); event.stopPropagation();
    const index = Number(event.currentTarget.dataset.word);
    onChange({ ...edit, words: edit.words.map((word, at) => at === index ? { ...word, deleted: event.key === "Delete" } : word) });
  };
  return <fieldset disabled={disabled} className="min-w-0 space-y-3">
    <p className="text-xs text-muted-foreground">{copy.selectHint}</p>
    <p className="text-xs text-muted-foreground">{copy.correctHint}</p>
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="outline" size="sm" onClick={selectPage}>{copy.selectAll}</Button><Button variant="ghost" size="sm" onClick={clear} disabled={!selected.size}>{copy.clear}</Button>
      <Button variant="outline" size="sm" onClick={remove} disabled={!selected.size}>{copy.remove}</Button><Button variant="outline" size="sm" onClick={restore} disabled={!selected.size}>{copy.restore}</Button>
      <span className="text-xs text-muted-foreground">{selected.size} {copy.selected}</span>
    </div>
    {selected.size === 1 && <div className="flex flex-wrap items-end gap-2"><label className="min-w-0 flex-1 text-sm">{copy.corrected}<input ref={node => { if (node && correcting.current) { correcting.current = false; node.focus(); node.select(); } }} value={text} maxLength={500} onChange={event => setText(event.target.value)} className="mt-1 w-full rounded-md border bg-background p-2 text-base sm:text-sm" /></label><Button size="sm" variant="outline" disabled={!text.trim()} onClick={correct}>{copy.applyText}</Button></div>}
    <div className="flex max-h-[24rem] min-h-24 flex-wrap content-start gap-2 overflow-y-auto rounded-lg border bg-muted/10 p-3" aria-label={copy.words}>
      {visible.map((word, offset) => {
        const index = start + offset;
        const current = time >= word.start && time < word.end;
        const changed = edit.words[index]!;
        return <span key={index} className={`inline-flex max-w-full items-center gap-1 rounded-md border px-2 ${current ? "border-primary bg-primary/10" : "border-transparent"}`}>
          <input type="checkbox" checked={selected.has(index)} onChange={event => toggle(index, event.target.checked)} aria-label={`${copy.selected} ${index + 1}: ${changed.text}`} className="size-4 shrink-0" />
          <button type="button" data-word={index} onDoubleClick={editWord} onKeyDown={wordKeys} className={`min-h-9 break-words px-1 py-1 text-left text-sm leading-relaxed ${changed.deleted ? "text-muted-foreground line-through" : "text-foreground"}`} onClick={() => seek(word.start)} title={`${word.start.toFixed(2)}–${word.end.toFixed(2)}s${word.kind === "filler" ? ` · ${copy.filler}` : ""}`}>{changed.text}{word.kind === "filler" && <span className="ml-1 text-xs text-muted-foreground">*</span>}{changed.deleted && <span className="sr-only"> {copy.edited}</span>}</button>
        </span>;
      })}
    </div>
    <div className="flex flex-wrap items-center justify-between gap-2 text-xs"><Button size="sm" variant="ghost" disabled={page === 0} onClick={() => setPage(page - 1)}>{copy.previous}</Button><span>{copy.page} {page + 1} / {Math.max(1, Math.ceil(transcript.words.length / WORDS_PER_PAGE))}</span><Button size="sm" variant="ghost" disabled={start + WORDS_PER_PAGE >= transcript.words.length} onClick={() => setPage(page + 1)}>{copy.next}</Button></div>
    {!!transcript.silences.length && <details className="rounded-lg border p-3"><summary className="cursor-pointer text-sm">{copy.silence} ({transcript.silences.length})</summary><div className="mt-2 flex max-h-40 flex-wrap gap-3 overflow-auto">{transcript.silences.map((silence, index) => <label key={index} className="flex min-h-9 items-center gap-2 text-sm"><input type="checkbox" checked={edit.silences[index]} onChange={event => onChange({ ...edit, silences: edit.silences.map((removed, at) => at === index ? event.target.checked : removed) })} />{silence.start.toFixed(2)}–{silence.end.toFixed(2)}s</label>)}</div></details>}
  </fieldset>;
}
