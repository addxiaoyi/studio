import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { act } from "@testing-library/react";
import { projectViewHref, type ProjectContext } from "@helstera/shared";
import { useProjectContext } from "@/hooks/use-project-context";
import { contextQuery, fetchProjectContext, updateProjectContext } from "@/lib/project-context-api";
import { ProjectViewNav } from "@/components/project-view-nav";

vi.mock("@/lib/project-context-api", async load => ({ ...await load<typeof import("@/lib/project-context-api")>(), fetchProjectContext:vi.fn(),updateProjectContext:vi.fn() }));
vi.mock("@/lib/i18n", () => ({ useLocale:() => "zh-CN" }));
const context: ProjectContext = {
  project:{id:"11111111-1111-4111-8111-111111111111",name:"网站介绍",workspaceId:"22222222-2222-4222-8222-222222222222"},
  canvas:{id:"33333333-3333-4333-8333-333333333333",name:"主画布"},
  session:{id:"44444444-4444-4444-8444-444444444444",title:"创作对话"},
  view:"video",compositionId:"网站 开场",revision:3,updatedAt:"2026-11-10T10:00:00.000Z",
};
afterEach(() => { cleanup();vi.clearAllMocks();sessionStorage.clear(); });

it("keeps distinct project, canvas and session identities in every view", () => {
  const href=projectViewHref(context,"video");
  expect(contextQuery(href)).toEqual({ projectId:context.project.id,canvasId:context.canvas.id,sessionId:context.session!.id });
  expect(new URL(href,"https://test.invalid").searchParams.get("composition")).toBe("网站 开场");
  expect(projectViewHref(context,"timeline",true)).toContain("/desktop-app/canvas/");
  expect(contextQuery(`/video/?timelineCanvas=${context.canvas.id}`)).toEqual({canvasId:context.canvas.id});
  expect(contextQuery(`/video?/MyComp#projectId=${context.project.id}&canvasId=${context.canvas.id}`)).toEqual({projectId:context.project.id,canvasId:context.canvas.id});
});

it("recovers server context and persists the first canvas visit", async () => {
  vi.mocked(fetchProjectContext).mockResolvedValue({...context,view:"canvas",revision:0});
  vi.mocked(updateProjectContext).mockResolvedValue({...context,view:"canvas",revision:1});
  const {result}=renderHook(()=>useProjectContext({userId:"owner",token:"token",address:`https://test.invalid/canvas/?id=${context.canvas.id}`,view:"canvas"}));
  await waitFor(()=>expect(result.current.loading).toBe(false));
  expect(updateProjectContext).toHaveBeenCalledWith("token",expect.objectContaining({expectedRevision:0,view:"canvas",canvasId:context.canvas.id}),expect.any(AbortSignal));
  expect(result.current.context?.project.id).toBe(context.project.id);
});

it("never changes a legacy standalone draft into the last cloud project after composition navigation", async () => {
  const first=renderHook(()=>useProjectContext({userId:"owner",token:"token",address:"https://test.invalid/video/?draft=1",view:"video",enabled:false}));
  first.unmount();
  const {result}=renderHook(()=>useProjectContext({userId:"owner",token:"token",address:"https://test.invalid/video?/MyComp",view:"video"}));
  await waitFor(()=>expect(result.current.loading).toBe(false));
  expect(fetchProjectContext).not.toHaveBeenCalled();
  expect(result.current.context).toBeNull();
});

it("blocks navigation when saving fails and exposes a retryable error", async () => {
  const beforeNavigate=vi.fn().mockRejectedValue(new Error("磁盘不可写，内容仍保留"));
  render(<ProjectViewNav context={context} current="video" beforeNavigate={beforeNavigate}/>);
  fireEvent.click(screen.getByRole("link",{name:"画布"}));
  await screen.findByRole("alert");
  expect(screen.getByRole("alert").textContent).toContain("内容仍保留");
  expect(beforeNavigate).toHaveBeenCalledWith("canvas");
  expect(screen.getByRole("link",{name:"视频剪辑"}).getAttribute("aria-current")).toBe("page");
});

it("keeps unavailable or unowned contexts from opening a different draft", async () => {
  vi.mocked(fetchProjectContext).mockRejectedValue(new Error("当前账号无权访问"));
  const {result}=renderHook(()=>useProjectContext({userId:"peer",token:"token",address:`https://test.invalid/video/?projectId=${context.project.id}`,view:"video"}));
  await waitFor(()=>expect(result.current.loading).toBe(false));
  expect(result.current.error).toBe("当前账号无权访问");
  expect(result.current.context).toBeNull();
  expect(updateProjectContext).not.toHaveBeenCalled();
});

it("serializes a composition update and view navigation using the latest receipt", async () => {
  vi.mocked(fetchProjectContext).mockResolvedValue(context);
  vi.mocked(updateProjectContext).mockImplementation(async (_,input) => ({...context,view:input.view,compositionId:input.compositionId,revision:input.expectedRevision+1}));
  const {result}=renderHook(()=>useProjectContext({userId:"owner",token:"token",address:"https://test.invalid/video/",view:"video"}));
  await waitFor(()=>expect(result.current.loading).toBe(false));
  await act(async()=>{await Promise.all([result.current.saveLocation("video","新片头"),result.current.saveLocation("canvas")]);});
  expect(vi.mocked(updateProjectContext).mock.calls.map(call=>call[1].expectedRevision)).toEqual([3,4]);
  expect(result.current.context?.compositionId).toBe("新片头");
  expect(result.current.context?.view).toBe("canvas");
});
