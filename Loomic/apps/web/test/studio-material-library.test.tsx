import "@testing-library/jest-dom/vitest";
import {cleanup,fireEvent,render,screen,waitFor} from "@testing-library/react";
import {afterEach,expect,it,vi} from "vitest";
import {StudioMaterialLibrary} from "@/components/studio-material-library";
import {fetchGeneratedAssets} from "@/lib/server-api";
import {readStudioAsset} from "@/lib/studio-media";
vi.mock("@/lib/i18n",()=>({useLocale:()=>"zh-CN"}));
vi.mock("@/lib/server-api",()=>({fetchGeneratedAssets:vi.fn()}));
vi.mock("@/lib/studio-media",()=>({readStudioAsset:vi.fn()}));
afterEach(()=>{cleanup();vi.clearAllMocks();});
const asset={id:"1",assetObjectId:"2",title:"原素材",retentionState:"active",mediaType:"image"};
it("imports only the selected authorized object and reports its real project name",async()=>{
  vi.mocked(fetchGeneratedAssets).mockResolvedValue({assets:[asset],pagination:{hasMore:false}} as never);
  vi.mocked(readStudioAsset).mockResolvedValue(new File(["bytes"],"2.png",{type:"image/png"}));
  const runtime={projectId:()=>"MyComp",readAsset:async()=>null,importAsset:vi.fn(),listMedia:()=>[{name:"generated-1-hash.png",mimeType:"image/png"}]},onImported=vi.fn();
  render(<StudioMaterialLibrary token="t" runtime={runtime as never} compositionId="MyComp" query="" onImported={onImported}/>);
  fireEvent.click(await screen.findByRole("button",{name:"导入工程"}));
  await waitFor(()=>expect(onImported).toHaveBeenCalledWith("generated-1-hash.png"));expect(readStudioAsset).toHaveBeenCalledWith("t","2");expect(runtime.importAsset).toHaveBeenCalledOnce();
});
it("keeps deleted assets out and preserves state when the private file is denied",async()=>{
  vi.mocked(fetchGeneratedAssets).mockResolvedValue({assets:[asset,{...asset,id:"deleted",title:"已删除",retentionState:"soft_deleted"}],pagination:{hasMore:false}} as never);
  vi.mocked(readStudioAsset).mockRejectedValue(new Error("素材下载失败或已过期"));
  const runtime={projectId:()=>"MyComp",readAsset:async()=>null,importAsset:vi.fn(),listMedia:()=>[]};
  render(<StudioMaterialLibrary token="t" runtime={runtime as never} compositionId="MyComp" query="" onImported={vi.fn()}/>);
  fireEvent.click(await screen.findByRole("button",{name:"导入工程"}));expect(await screen.findByRole("alert")).toHaveTextContent("已过期");expect(screen.queryByText("已删除")).toBeNull();expect(runtime.importAsset).not.toHaveBeenCalled();
});
