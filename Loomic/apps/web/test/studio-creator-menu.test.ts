// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { creatorCompositionMenu, openStudioExport, studioTargetLabel } from "@/lib/studio-ai-context";
afterEach(() => {document.body.replaceChildren();vi.restoreAllMocks();});

it("keeps user editing operations while removing duplicate and developer-only entries", () => {
  const entries = ["copy-context-for-agents","annotate-composition","copy-file-location","copy-id","rename","duplicate","delete"].map(id => ({id,type:"item"}));
  expect(creatorCompositionMenu(entries).map(item=>item.id)).toEqual(["copy-context-for-agents","rename","duplicate","delete"]);
});
it("opens the current browser export dialog and never starts a server handoff", () => {
  const browser = document.createElement("button"), server = document.createElement("button");
  browser.id="render-modal-button-client";server.id="render-modal-button-server";
  const click=vi.fn(), forbidden=vi.fn();browser.onclick=click;server.onclick=forbidden;document.body.append(browser,server);
  openStudioExport();expect(click).toHaveBeenCalledOnce();expect(forbidden).not.toHaveBeenCalled();
  browser.remove();expect(()=>openStudioExport()).toThrow("选择");
});
it("describes the selection without displaying source paths", () => {
  expect(studioTargetLabel({compositionId:"MyComp",label:"Title",context:"Title in src/Title.tsx:11"})).toBe("Title");
  expect(studioTargetLabel({compositionId:"MyComp",label:"MyComp",context:"MyComp in src/Composition.tsx:11"})).toBe("");
});
it("targets the compiled composition when several export controls are mounted", () => {
  const old = document.createElement("button"), current = document.createElement("button");
  old.id = current.id = "render-modal-button-client";
  old.dataset.compositionId = "MyComp"; current.dataset.compositionId = "Canvas-test";
  const wrongExport = vi.fn(), correctExport = vi.fn();
  old.onclick = wrongExport; current.onclick = correctExport;
  document.body.append(old, current);
  openStudioExport("Canvas-test");
  expect(correctExport).toHaveBeenCalledOnce(); expect(wrongExport).not.toHaveBeenCalled();
  current.remove(); expect(() => openStudioExport("Canvas-test")).toThrow("选择");
});
