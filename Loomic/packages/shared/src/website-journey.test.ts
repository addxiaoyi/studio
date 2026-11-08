import { expect,it } from "vitest";
import { createWebsiteCaptureRequestSchema } from "./website-capture.js";
import { websiteHandoffRequestSchema } from "./website-journey.js";
const journey={goal:'先看首页，再看定价',summary:'浏览两个页面',steps:[{title:'首页',url:'https://example.com/',scroll:true},{title:'定价',linkText:'定价',scroll:true}]};
it('binds ordered steps and rejects scope escalation',()=>{
  const request={url:'https://example.com/',mode:'isolated',recordVideo:true,idempotencyKey:'journey',pageLimit:2,journey};
  expect(createWebsiteCaptureRequestSchema.parse(request).journey?.steps).toEqual(journey.steps);
  expect(createWebsiteCaptureRequestSchema.safeParse({...request,pageLimit:1}).success).toBe(false);
  expect(createWebsiteCaptureRequestSchema.safeParse({...request,journey:{...journey,steps:[{title:'离开',url:'https://evil.example/'}]}}).success).toBe(false);
  expect(createWebsiteCaptureRequestSchema.safeParse({...request,journey:{...journey,steps:[{title:'删除',linkText:'删除账户'}]}}).success).toBe(false);
});
it('requires bounded human inputs and a frame binding',()=>{
  expect(websiteHandoffRequestSchema.safeParse({input:{kind:'text',text:'123456'}}).success).toBe(false);
  const input={id:'00000000-0000-4000-8000-000000000001',viewId:'00000000-0000-4000-8000-000000000002',frameRevision:1,pageUrl:'https://example.com/login'};
  expect(websiteHandoffRequestSchema.safeParse({...input,input:{kind:'click',x:1.1,y:0}}).success).toBe(false);
  expect(websiteHandoffRequestSchema.safeParse({...input,input:{kind:'key',key:'Control+R'}}).success).toBe(false);
});
