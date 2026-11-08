import { expect,it,vi } from "vitest";
import { planWebsiteJourney } from "./journey-planner.js";
const input={url:'https://example.com/',goal:'先看首页，再看定价'};
const plan={summary:'按指定顺序浏览',steps:[{title:'首页',url:input.url,scroll:true},{title:'定价',url:'https://example.com/pricing',scroll:true}],recording:'browsing',durationSeconds:24,loginSuggested:false};
it('calls the model and preserves the ordered route',async()=>{
  const invoke=vi.fn().mockResolvedValue({content:JSON.stringify(plan)});
  expect(await planWebsiteJourney({invoke} as never,input,{title:'Site',links:[{text:'定价',url:'https://example.com/pricing'}]})).toEqual(plan);
  expect(invoke).toHaveBeenCalledTimes(1);
});
it('rejects invented URLs instead of silently replacing the model plan',async()=>{
  await expect(planWebsiteJourney({invoke:async()=>({content:JSON.stringify(plan)})} as never,input,{title:'Site',links:[]})).rejects.toThrow('未经观察');
});
