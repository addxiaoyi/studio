import {webcrypto} from "node:crypto";
import {afterEach,expect,it,vi} from "vitest";
import {syncProjectVideo,videoSyncReceipt,projectDocumentDiff} from "@/lib/project-video-sync";
import {saveProjectVideo} from "@/lib/project-video-api";
import type {ProjectVideoDocument} from "@helstera/shared";

const copies=vi.hoisted(()=>new Map<string,unknown>());
vi.mock("@/lib/visualforge-storage",()=>({readStudioSync:vi.fn(async(key:string)=>copies.get(key)),saveStudioSync:vi.fn(async(key:string,value:unknown)=>{copies.set(key,structuredClone(value));})}));
vi.mock("@/lib/project-video-api",()=>({saveProjectVideo:vi.fn()}));
afterEach(()=>{copies.clear();vi.clearAllMocks();vi.unstubAllGlobals();});
const document:ProjectVideoDocument={version:1,rootDir:"/project",entryPoint:"/project/index.ts",files:{"/project/index.ts":"export const title='one';"},assets:[],state:{}};

it("retries the exact saved mutation when a response is lost, preserving newer local edits",async()=>{
  vi.stubGlobal("crypto",webcrypto);
  const base={token:"token",projectId:"project",projectKey:"owner:project:project",document,expectedRevision:0};
  vi.mocked(saveProjectVideo).mockRejectedValueOnce(new Error("connection lost"));
  await expect(syncProjectVideo(base)).rejects.toThrow("connection lost");
  const pending=(await videoSyncReceipt(base.projectKey)).pending!;
  expect(pending.mutationId).toBeTruthy();
  const changed={...document,files:{"/project/index.ts":"export const title='two';"}};
  await expect(syncProjectVideo({...base,document:changed})).rejects.toThrow("未确认");
  vi.mocked(saveProjectVideo).mockResolvedValueOnce({revision:1,updatedAt:"2026-11-11T00:00:00.000Z",syncEnabled:true,document});
  await syncProjectVideo({...base,document:changed,retryPending:true});
  expect(vi.mocked(saveProjectVideo).mock.calls[1]![2]).toEqual(pending);
  expect((await videoSyncReceipt(base.projectKey)).pending).toBeUndefined();
  expect((await videoSyncReceipt("peer:project:project")).revision).toBe(0);
});

it("compares real changed files and media identities",()=>{
  const cloud={...document,files:{"/project/index.ts":"changed","/project/extra.ts":"extra"},assets:[{name:"image.png",size:30,mimeType:"image/png",assetId:null,sha256:null}]};
  expect(projectDocumentDiff(document,cloud)).toEqual({added:["/project/extra.ts"],removed:[],changed:["/project/index.ts"],media:["image.png"]});
});
