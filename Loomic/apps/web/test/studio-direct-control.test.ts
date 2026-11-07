import { expect, it } from "vitest";
import { studioDirectControl } from "@/lib/studio-direct-control";
it("recognizes explicit commands while leaving questions and negation to conversation",()=>{
  expect(studioDirectControl("播放当前视频")).toEqual({type:"play"});
  expect(studioDirectControl("暂停预览")).toEqual({type:"pause"});
  expect(studioDirectControl("定位到1.5秒。")).toEqual({type:"seek",seconds:1.5});
  for(const prompt of ["不要播放","能否播放视频？","如果有片段就播放","撤销全部工程","导出并上传"]){expect(studioDirectControl(prompt)).toBeNull();}
});
