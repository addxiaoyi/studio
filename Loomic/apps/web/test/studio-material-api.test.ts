import {afterEach,expect,it,vi} from "vitest";
import {submitMaterialVideo} from "@/lib/studio-material-api";
vi.mock("@/lib/env",()=>({getServerBaseUrl:()=>"http://localhost:3311"}));
afterEach(()=>vi.unstubAllGlobals());
it("requests a mandatory quote and preserves the idempotent request and approval data",async()=>{
  const fetch=vi.fn().mockResolvedValue(new Response(JSON.stringify({error:{code:"generation_confirmation_required",message:"confirm"},data:{approvalId:"pending",estimatedCredits:15}}),{status:409,headers:{"content-type":"application/json"}}));vi.stubGlobal("fetch",fetch);
  await expect(submitMaterialVideo("token",{key:"key",draft:{prompt:"镜头",model:"test",duration:5,resolution:"720p",aspectRatio:"16:9",requireConfirmation:true}})).rejects.toMatchObject({code:"generation_confirmation_required",details:{approvalId:"pending",estimatedCredits:15}});
  expect(fetch).toHaveBeenCalledWith(expect.any(String),expect.objectContaining({headers:expect.objectContaining({"x-generation-confirmation":"required","idempotency-key":"key"})}));
});
