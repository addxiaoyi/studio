import { createHash } from "node:crypto";
import type { ProjectBackup } from "@helstera/shared";

type ChangeCount = { added: number; removed: number; changed: number };
export type SnapshotDifference = { elements: ChangeCount; messages: ChangeCount; settingsChanged: boolean; mediaChanged: boolean };
export type SnapshotOverview = { thumbnail: string; text: string[]; messages: Array<{ role: string; content: string }>; truncated: boolean };
const escape = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[char]!);
const number = (value: unknown, fallback = 0) => typeof value === "number" && Number.isFinite(value) ? Math.max(-1e7, Math.min(1e7, value)) : fallback;
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return "{" + Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${JSON.stringify(key)}:${stable(value)}`).join(",") + "}";
  return JSON.stringify(value) ?? "null";
}
const digest = (value: unknown) => createHash("sha256").update(stable(value)).digest("hex");
function changes(before: Map<string, string>, after: Map<string, string>): ChangeCount {
  return { added: [...after.keys()].filter(id => !before.has(id)).length, removed: [...before.keys()].filter(id => !after.has(id)).length, changed: [...after].filter(([id, value]) => before.has(id) && before.get(id) !== value).length };
}
export function compareSnapshots(before: ProjectBackup, after: ProjectBackup): SnapshotDifference {
  const elements = (snapshot: ProjectBackup) => new Map(snapshot.canvas.content.elements.filter(e => !e.isDeleted).map((element, index) => {
    const { version, versionNonce, updated, seed, ...content } = element;
    return [String(element.id ?? index), digest(content)];
  }));
  const messages = (snapshot: ProjectBackup) => new Map(snapshot.sessions.flatMap(session => session.messages.map((message, index) => [`${session.id}:${message.id ?? index}`, digest({ role: message.role, content: message.content, contentBlocks: message.contentBlocks })])));
  return { elements: changes(elements(before), elements(after)), messages: changes(messages(before), messages(after)), settingsChanged: digest(before.canvas.content.appState) !== digest(after.canvas.content.appState), mediaChanged: digest(before.canvas.content.files) !== digest(after.canvas.content.files) };
}

export function snapshotOverview(snapshot: ProjectBackup): SnapshotOverview {
  const elements = snapshot.canvas.content.elements.filter(element => !element.isDeleted);
  const bounded = elements.slice(0, 200);
  const left = Math.min(0, ...bounded.map(e => number(e.x))), top = Math.min(0, ...bounded.map(e => number(e.y)));
  const width = Math.max(320, ...bounded.map(e => number(e.x) + Math.max(1, number(e.width, 100)) - left));
  const height = Math.max(180, ...bounded.map(e => number(e.y) + Math.max(1, number(e.height, 60)) - top));
  const scale = Math.min(304 / width, 164 / height);
  const shapes = bounded.map(e => {
    const x = 8 + (number(e.x) - left) * scale, y = 8 + (number(e.y) - top) * scale;
    const w = Math.max(8, number(e.width, 120) * scale), h = Math.max(8, number(e.height, 50) * scale);
    const custom = e.customData as { isVideo?: boolean; isAudio?: boolean; title?: string } | undefined;
    const label = e.type === "text" ? String(e.text ?? "").slice(0, 50) : custom?.isVideo ? "▶ 视频" : custom?.isAudio ? "♫ 音频" : e.type === "image" ? "▧ 图片" : String(custom?.title ?? "").slice(0, 30);
    const fill = e.type === "text" ? "none" : custom?.isVideo ? "#e2e8f0" : e.type === "image" ? "#d1e8dd" : "#eef0f3";
    const shape = e.type === "ellipse" ? `<ellipse cx="${x + w / 2}" cy="${y + h / 2}" rx="${w / 2}" ry="${h / 2}" fill="${fill}" stroke="#a5acb7"/>` : `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="2" fill="${fill}" stroke="${e.type === "text" ? "none" : "#a5acb7"}"/>`;
    return `${shape}${label ? `<text x="${x + 3}" y="${y + Math.min(h - 1, 13)}" fill="#243044" font-size="${Math.max(6, Math.min(12, number(e.fontSize, 16) * scale))}" font-family="sans-serif">${escape(label)}</text>` : ""}`;
  }).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 320 180"><rect width="320" height="180" fill="#fff"/>${shapes || '<text x="16" y="90" fill="#64748b" font-size="14">空白画布</text>'}</svg>`;
  const messages = snapshot.sessions.flatMap(session => session.messages).slice(-80).map(m => ({ role: m.role, content: m.content.slice(0, 2000) }));
  return { thumbnail: `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`, text: elements.filter(e => e.type === "text").slice(0, 50).map(e => String(e.text ?? "").slice(0, 2000)), messages, truncated: elements.length > 200 || snapshot.sessions.reduce((sum, s) => sum + s.messages.length, 0) > 80 };
}
