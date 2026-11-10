import {expect,test} from "bun:test";
import {createHash} from "node:crypto";
import {portableStudioProject} from "./project-document";

test("portable projects carry source and media fingerprints without uploading file bytes",async()=>{
  const media=new Uint8Array([1,3,5,7]);
  const name="generated-11111111-1111-4111-8111-111111111111-source.mp4";
  const portable=await portableStudioProject({rootDir:"/project",entryPoint:"/project/src/index.ts",files:{"/project/src/index.ts":"export const title='Hello';"},publicFiles:{[name]:media}});
  expect(portable.files["/project/src/index.ts"]).toContain("Hello");
  expect(portable.assets).toEqual([{name,size:4,mimeType:"video/mp4",assetId:"11111111-1111-4111-8111-111111111111",sha256:createHash("sha256").update(media).digest("hex")}]);
  expect(portable).not.toHaveProperty("publicFiles");
  expect(portable).not.toHaveProperty("publicFileStorage");
});

test("same names and sizes in different projects cannot reuse another file's checksum",async()=>{
  const base={rootDir:"/project",entryPoint:"/project/src/index.ts",files:{"/project/src/index.ts":"export {};"}};
  const first=await portableStudioProject({...base,publicFiles:{"image.png":new Uint8Array([1,2])}});
  const second=await portableStudioProject({...base,publicFiles:{"image.png":new Uint8Array([3,4])}});
  expect(first.assets[0]!.sha256).not.toBe(second.assets[0]!.sha256);
});
