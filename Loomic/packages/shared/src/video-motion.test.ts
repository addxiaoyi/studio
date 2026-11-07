import {expect,it} from "vitest";
import {validateMotion,validateTransitions} from "./video-motion.js";
it("rejects ambiguous times and excessive keyframe values",()=>{
  expect(()=>validateMotion([{property:"opacity",points:[{timeMs:0,value:0,ease:"none"},{timeMs:900,value:1,ease:"power2.out"}]}],0,1000)).not.toThrow();
  expect(()=>validateMotion([{property:"scale",points:[{timeMs:1,value:1,ease:"none"},{timeMs:1,value:2,ease:"none"}]}],0,1000)).toThrow("递增");
  expect(()=>validateMotion([{property:"opacity",points:[{timeMs:0,value:0,ease:"none"},{timeMs:900,value:2,ease:"none"}]}],0,1000)).toThrow("数值");
});
it("bounds transitions to adjacent clips and rejects duplicates",()=>{
  const clips=[{start:0,end:2},{start:0,end:1}];
  expect(()=>validateTransitions([{afterClip:0,durationMs:300,style:"fade"}],clips)).not.toThrow();
  expect(()=>validateTransitions([{afterClip:0,durationMs:600,style:"fade"}],clips)).toThrow("一半");
  expect(()=>validateTransitions([{afterClip:1,durationMs:100,style:"fade"}],clips)).toThrow();
});
