import Fastify from "fastify";
import {expect,it,vi} from "vitest";
import {registerJobRoutes} from "./jobs.js";
const gate=vi.hoisted(()=>vi.fn());
vi.mock("../features/generation/generation-approval-service.js",async original=>({...await original<typeof import("../features/generation/generation-approval-service.js")>(),createGenerationApprovalService:()=>({gate})}));
vi.mock("../features/agent-goals/connector-gate.js",async original=>({...await original<typeof import("../features/agent-goals/connector-gate.js")>(),assertConnectorEnabled:async()=>undefined}));
vi.mock("./model-availability.js",()=>({resolveConfiguredModel:async()=>({model_id:"test-video",provider_id:"test",supports_audio:false})}));
it("forces a fresh material approval before queue creation even when auto approval is configured",async()=>{
  gate.mockResolvedValue({state:"confirmation_required",request:{approvalId:"pending",estimatedCredits:12}});
  const app=Fastify(),createJob=vi.fn();
  await registerJobRoutes(app,{auth:{authenticate:async()=>({id:"u"})} as never,viewerService:{ensureViewer:async()=>({workspace:{id:"w"}})} as never,jobService:{createJob} as never,localDb:{query:async()=>({rows:[]})} as never});
  try{
    const response=await app.inject({method:"POST",url:"/api/jobs/video-generation",headers:{"x-generation-confirmation":"required"},payload:{prompt:"一段镜头",model:"test-video"}});
    expect(response.statusCode).toBe(409);expect(gate).toHaveBeenCalledWith(expect.objectContaining({forceConfirmation:true,jobType:"video_generation"}));expect(createJob).not.toHaveBeenCalled();
  }finally{await app.close();}
});
it("rejects material submission when the approval service is unavailable",async()=>{
  const app=Fastify(),createJob=vi.fn();await registerJobRoutes(app,{auth:{authenticate:async()=>({id:"u"})} as never,viewerService:{} as never,jobService:{createJob} as never});
  try{const response=await app.inject({method:"POST",url:"/api/jobs/video-generation",headers:{"x-generation-confirmation":"required"},payload:{prompt:"镜头"}});expect(response.statusCode).toBe(503);expect(createJob).not.toHaveBeenCalled();}finally{await app.close();}
});
