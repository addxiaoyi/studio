import {expect,it} from "vitest";
import {keepStudioBrandTitle} from "@/lib/studio-brand";
it("preserves the Helstera title when embedded compilation writes a third-party title",async()=>{
  document.title="MyComp / template-blank - VisualForge Studio";
  const dispose=keepStudioBrandTitle();expect(document.title).toBe("视频创作 | Helstera");
  document.title="NewComposition - VisualForge Studio";await new Promise(resolve=>setTimeout(resolve,0));expect(document.title).toBe("视频创作 | Helstera");
  dispose();document.title="素材库";await new Promise(resolve=>setTimeout(resolve,0));expect(document.title).toBe("素材库");
});
