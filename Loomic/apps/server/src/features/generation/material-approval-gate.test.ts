import {expect,it,vi} from "vitest";
import {createGenerationApprovalService} from "./generation-approval-service.js";
it.each([0,12])("requires a fresh material decision at %s credits despite automatic approval",async estimatedCredits=>{
  const query=vi.fn().mockResolvedValueOnce({rows:[{enabled:true}]}).mockResolvedValueOnce({rows:[]}).mockResolvedValueOnce({rows:[]}).mockResolvedValueOnce({rows:[{id:"quote",expires_at:"2099-01-01T00:00:00Z"}]});
  const gate=await createGenerationApprovalService({query} as never).gate({workspaceId:"w",userId:"u",jobType:"video_generation",model:"test",payload:{prompt:"镜头"},estimatedCredits,forceConfirmation:true});
  expect(gate).toMatchObject({state:"confirmation_required",request:{approvalId:"quote",estimatedCredits}});
  expect(query.mock.calls.some(call=>String(call[0]).includes("status = 'approved'"))).toBe(false);
});
