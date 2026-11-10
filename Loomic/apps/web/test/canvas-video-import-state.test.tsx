import {afterEach,expect,it,vi} from "vitest";
import {cleanup,render,screen} from "@testing-library/react";
import {CanvasVideoImport} from "@/components/capture-recording-import";

vi.mock("@/lib/server-api",()=>({fetchWebsiteCapture:vi.fn()}));
vi.mock("@/lib/studio-media",()=>({readStudioAsset:vi.fn()}));
afterEach(()=>{cleanup();history.replaceState(null,"","/");});

it("reports blocked editor recovery instead of claiming to import media",async()=>{
  history.replaceState(null,"","/video/?assetId=11111111-1111-4111-8111-111111111111");
  render(<CanvasVideoImport runtime={null} token="test" onImported={vi.fn()} blockedReason="请先恢复当前工程的本机副本"/>);
  expect((await screen.findByRole("alert")).textContent).toContain("请先恢复当前工程的本机副本");
  expect(screen.queryByText("正在导入画布视频…")).toBeNull();
});
