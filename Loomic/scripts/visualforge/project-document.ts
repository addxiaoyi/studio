import { projectVideoDocumentSchema, type ProjectVideoDocument } from "../../packages/shared/src/project-video-document";
import type { VirtualProject } from "../../vendor/visualforge/packages/browser-studio/src/types";
import { createBrowserStudioProjectStorage, deleteBrowserStudioProjectStorage, getBrowserStudioStoredPublicFile, writeBrowserStudioStoredPublicFile } from "../../vendor/visualforge/packages/browser-studio/src/opfs-public-files";
import { lockStudio } from "../../apps/web/src/lib/visualforge-session";
import { readStudioProject, replaceStudioProject } from "../../apps/web/src/lib/visualforge-storage";
import {projectDocumentHash} from "../../apps/web/src/lib/project-video-sync";
import {mediaFileHash} from "../../apps/web/src/lib/media-file-hash";

const stateKeys = ["loomicCut","loomicCuts","loomicAppliedEdits","loomicEditJournals","canvasImports"] as const;
const digests = new Map<string,string>();
const mimeTypes: Record<string,string> = {mp4:"video/mp4",webm:"video/webm",mp3:"audio/mpeg",wav:"audio/wav",png:"image/png",jpg:"image/jpeg",jpeg:"image/jpeg",webp:"image/webp",svg:"image/svg+xml"};

export async function portableStudioProject(project: VirtualProject,signal?:AbortSignal): Promise<ProjectVideoDocument> {
  const assets: ProjectVideoDocument["assets"]=[];
  for(const [name,entry] of Object.entries(project.publicFiles ?? {})) {
    signal?.throwIfAborted();
    let file: File;
    let signature: string | undefined;
    if(typeof entry==="object" && "type" in entry && entry.type==="stored") {
      if(!project.publicFileStorage) throw new Error("工程缺少本机素材目录，请重新关联后同步。");
      file=await getBrowserStudioStoredPublicFile({file:entry,storage:project.publicFileStorage});
      signature=`${project.publicFileStorage.directoryName}:${entry.key}:${file.size}:${file.lastModified}`;
    } else if(typeof entry==="string") file=new File([entry],name);
    else if(entry instanceof Uint8Array) file=new File([new Uint8Array(entry)],name);
    else throw new Error(`素材存储格式无效：${name}`);
    const digest=(signature ? digests.get(signature) : undefined) ?? await mediaFileHash(file,signal);
    if(signature && digest) {if(digests.size>=2000)digests.clear();digests.set(signature,digest);}
    const assetId=name.match(/^generated-([a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12})-/i)?.[1] ?? null;
    assets.push({name,size:file.size,mimeType:file.type || mimeTypes[name.split(".").pop()?.toLowerCase() ?? ""] || "application/octet-stream",assetId,sha256:digest});
  }
  const state = Object.fromEntries(stateKeys.flatMap(key => key in project ? [[key,(project as unknown as Record<string,unknown>)[key]]] : []));
  return projectVideoDocumentSchema.parse({version:1,rootDir:project.rootDir,entryPoint:project.entryPoint,files:project.files,assets,state});
}

export async function restoreStudioDocument(input: {projectKey:string;document:ProjectVideoDocument;files:Record<string,File>;expectedLocalHash?:string|null}) {
  const document=projectVideoDocumentSchema.parse(input.document),release=await lockStudio(input.projectKey);
  let storage: Awaited<ReturnType<typeof createBrowserStudioProjectStorage>> | undefined;
  let committed=false;
  try {
    const current=await readStudioProject<VirtualProject>(input.projectKey);
    if(current && (!input.expectedLocalHash || await projectDocumentHash(await portableStudioProject(current))!==input.expectedLocalHash)) throw new Error("本机视频已有修改，请重新比较后确认恢复，原工程未覆盖。");
    if(!current && input.expectedLocalHash)throw new Error("本机工程在确认后发生变化，请重新比较后恢复。");
    for(const asset of document.assets) {
      const file=input.files[asset.name];
      if(!file || file.size!==asset.size) throw new Error(`素材尚未匹配：${asset.name}`);
      if(asset.sha256) {
        const digest=await mediaFileHash(file);
        if(digest!==asset.sha256) throw new Error(`素材校验未通过：${asset.name}。未覆盖工程。`);
      }
    }
    storage=await createBrowserStudioProjectStorage();
    if(document.assets.length && !storage) throw new Error("当前浏览器不支持可靠的本机素材存储，请使用桌面客户端。");
    const publicFiles: NonNullable<VirtualProject["publicFiles"]>={};
    for(const asset of document.assets) publicFiles[asset.name]=await writeBrowserStudioStoredPublicFile({storage:storage!,contents:input.files[asset.name]!});
    const backupKey=await replaceStudioProject(input.projectKey,{...document.state,entryPoint:document.entryPoint,rootDir:document.rootDir,files:document.files,publicFiles,...(storage?{publicFileStorage:storage}:{})});
    committed=true;
    return current?backupKey:null;
  } finally {
    try {if(!committed && storage)await deleteBrowserStudioProjectStorage(storage);}
    finally {release();}
  }
}

export async function restoreStudioRecovery(input:{projectKey:string;backupKey:string;expectedLocalHash:string|null}) {
  if(!input.backupKey.startsWith(`${input.projectKey}:recovery:`))throw new Error("恢复副本不属于当前工程。");
  const release=await lockStudio(input.projectKey);
  try {
    const backup=await readStudioProject<VirtualProject>(input.backupKey);
    if(!backup)throw new Error("本机恢复副本已不存在。");
    await portableStudioProject(backup);
    const current=await readStudioProject<VirtualProject>(input.projectKey);
    if(current && (!input.expectedLocalHash || await projectDocumentHash(await portableStudioProject(current))!==input.expectedLocalHash))throw new Error("本机工程已改变，请重新确认后恢复。");
    if(!current && input.expectedLocalHash)throw new Error("当前工程已不存在，请重新核对。");
    await replaceStudioProject(input.projectKey,backup);
  } finally {release();}
}
