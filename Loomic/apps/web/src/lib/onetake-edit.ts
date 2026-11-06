import { compileTranscript, type Transcript, type TranscriptEdit } from "@helstera/shared";

export type EditHistory = { past: TranscriptEdit[]; present: TranscriptEdit; future: TranscriptEdit[] };
export type EditAction = { type: "edit"; edit: TranscriptEdit } | { type: "undo" } | { type: "redo" };
export function transcriptHistory(state: EditHistory, action: EditAction): EditHistory {
  if (action.type === "undo") {
    const previous = state.past.at(-1);
    return previous ? { past: state.past.slice(0, -1), present: previous, future: [state.present, ...state.future] } : state;
  }
  if (action.type === "redo") {
    const next = state.future[0];
    return next ? { past: [...state.past, state.present], present: next, future: state.future.slice(1) } : state;
  }
  if (JSON.stringify(state.present) === JSON.stringify(action.edit)) return state;
  return { past: [...state.past.slice(-49), state.present], present: action.edit, future: [] };
}

export function editedPlaybackTime(document: Transcript, edit: TranscriptEdit, seconds: number): number {
  const segments = compileTranscript(document, edit).segments;
  const next = segments.find(segment => seconds < segment.end);
  return next ? Math.max(next.start, seconds) : document.duration;
}
