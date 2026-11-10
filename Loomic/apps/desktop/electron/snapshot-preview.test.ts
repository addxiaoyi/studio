import { expect, it } from "vitest";
import { compareSnapshots, snapshotOverview } from "./snapshot-preview.js";
import type { ProjectBackup } from "@helstera/shared";
const before = { project: { id: "project", name: "local" }, canvas: { content: { elements: [{ id: "a", type: "text", text: "old", version: 1 }, { id: "b", type: "image" }], appState: {}, files: {} } }, sessions: [{ id: "s", messages: [{ id: "m", role: "user", content: "old" }] }] } as unknown as ProjectBackup;
it("counts semantic differences without treating revision metadata as content changes", () => {
  const after = structuredClone(before);
  after.canvas.content.elements = [{ ...before.canvas.content.elements[0], version: 3 }, { id: "c", type: "rectangle" }];
  after.sessions[0].messages[0].content = "new";
  expect(compareSnapshots(before, after)).toEqual({ elements: { added: 1, removed: 1, changed: 0 }, messages: { added: 0, removed: 0, changed: 1 }, settingsChanged: false, mediaChanged: false });
});
it("creates an inert local thumbnail without requesting media URLs or embedding markup", () => {
  const snapshot = structuredClone(before); snapshot.canvas.content.elements[0].text = '<script>bad()</script><image href="https://external.test"/>';
  const preview = snapshotOverview(snapshot), svg = Buffer.from(preview.thumbnail.split(",")[1], "base64").toString();
  expect(svg).not.toContain("<script>"); expect(svg).not.toContain('<image href='); expect(svg).toContain("&lt;script&gt;");
  expect(preview.messages[0].content).toBe("old");
});
