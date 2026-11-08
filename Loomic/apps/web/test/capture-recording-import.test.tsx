import { expect,it,vi } from "vitest";
import { importCaptureRecording } from "../src/components/capture-recording-import";
vi.mock('@/lib/server-api',()=>({fetchWebsiteCapture:vi.fn(async()=>({task:{status:'succeeded',result:{recordingAssetId:'asset-1',title:'体验录像'}}}))}));
vi.mock('@/lib/studio-media',()=>({readStudioAsset:vi.fn(async()=>new File(['video'],'capture.webm',{type:'video/webm'}))}));
it('imports a private recording once even when mounts or clicks overlap',async()=>{
  let file:File|null=null;
  const runtime={readAsset:vi.fn(async()=>file),importAsset:vi.fn(async(value:File)=>{file=value;})};
  await Promise.all([importCaptureRecording(runtime as never,'token','task'),importCaptureRecording(runtime as never,'token','task')]);
  expect(runtime.importAsset).toHaveBeenCalledTimes(1);
  await importCaptureRecording(runtime as never,'token','task');expect(runtime.importAsset).toHaveBeenCalledTimes(1);
});
