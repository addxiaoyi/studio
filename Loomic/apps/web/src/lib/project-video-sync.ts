import {projectVideoDocumentSchema,projectSyncReceiptSchema,type ProjectVideoDocument,type ProjectVideoRevision,type ProjectSyncReceipt} from "@helstera/shared";
import {readStudioSync,saveStudioSync} from "./visualforge-storage";
import {saveProjectVideo} from "./project-video-api";

export type VideoSyncReceipt=ProjectSyncReceipt;

function sorted(value:unknown):unknown {
  if(Array.isArray(value))return value.map(sorted);
  if(!value||typeof value!=="object")return value;
  return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,child])=>[key,sorted(child)]));
}

export async function projectDocumentHash(document:ProjectVideoDocument) {
  const bytes=new TextEncoder().encode(JSON.stringify(sorted(projectVideoDocumentSchema.parse(document))));
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256",bytes))].map(byte=>byte.toString(16).padStart(2,"0")).join("");
}

export async function videoSyncReceipt(key:string):Promise<VideoSyncReceipt> {
  const value=await readStudioSync(key);
  return value===undefined?{revision:0,hash:null}:projectSyncReceiptSchema.parse(value);
}

export async function rememberVideoRevision(key:string,cloud:ProjectVideoRevision) {
  const receipt={revision:cloud.revision,hash:await projectDocumentHash(cloud.document)};
  await saveStudioSync(key,receipt);
  return receipt;
}

export async function syncProjectVideo(input:{token:string;projectId:string;projectKey:string;document:ProjectVideoDocument;expectedRevision:number;retryPending?:boolean}) {
  const current=await videoSyncReceipt(input.projectKey);
  const pending=input.retryPending && current.pending ? current.pending : {document:input.document,expectedRevision:input.expectedRevision,mutationId:crypto.randomUUID(),syncEnabled:true};
  if(!input.retryPending && current.pending)throw new Error("仍有未确认的保存请求，请先重试原请求以核对是否已保存。");
  await saveStudioSync(input.projectKey,{...current,pending});
  const cloud=await saveProjectVideo(input.token,input.projectId,pending);
  await rememberVideoRevision(input.projectKey,cloud);
  return cloud;
}

export async function discardRejectedVideoSave(key:string) {
  const receipt=await videoSyncReceipt(key);
  await saveStudioSync(key,{revision:receipt.revision,hash:receipt.hash});
}

export function projectDocumentDiff(local:ProjectVideoDocument|null,cloud:ProjectVideoDocument) {
  const before=local?.files??{},after=cloud.files;
  const added=Object.keys(after).filter(path=>!(path in before));
  const removed=Object.keys(before).filter(path=>!(path in after));
  const changed=Object.keys(after).filter(path=>path in before && before[path]!==after[path]);
  const references=new Map(local?.assets.map(asset=>[asset.name,asset]));
  const media=cloud.assets.filter(asset=>{const old=references.get(asset.name);return !old||old.size!==asset.size||old.sha256!==asset.sha256;}).map(asset=>asset.name);
  return {added,removed,changed,media};
}
