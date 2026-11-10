import {projectVideoRevisionSchema,projectVideoVersionsSchema,type ProjectVideoRevision,type ProjectVideoWrite,type ProjectVideoVersion} from "@helstera/shared";
import {getServerBaseUrl} from "./env";
import {ProjectContextRequestError} from "./project-context-api";
export type {ProjectVideoVersion} from "@helstera/shared";

export async function fetchProjectVideoVersions(token:string,projectId:string):Promise<ProjectVideoVersion[]> {
  const response=await fetch(`${getServerBaseUrl()}/api/projects/${encodeURIComponent(projectId)}/video-document/versions`,{credentials:"include",headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(15_000),cache:"no-store"});
  const body=await response.json();
  if(!response.ok)throw new ProjectContextRequestError(response.status,body.error?.message??"暂时无法读取工程版本。");
  return projectVideoVersionsSchema.parse(body.data);
}

export async function fetchProjectVideo(token:string,projectId:string,revision?:number):Promise<ProjectVideoRevision|null> {
  const response=await fetch(`${getServerBaseUrl()}/api/projects/${encodeURIComponent(projectId)}/video-document${revision?`?revision=${revision}`:""}`,{
    credentials:"include",headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(15_000),cache:"no-store",
  });
  const body=await response.json();
  if(!response.ok)throw new ProjectContextRequestError(response.status,body.error?.message??"无法读取工程同步版本。");
  return body.data===null?null:projectVideoRevisionSchema.parse(body.data);
}

export async function saveProjectVideo(token:string,projectId:string,input:ProjectVideoWrite):Promise<ProjectVideoRevision> {
  const response=await fetch(`${getServerBaseUrl()}/api/projects/${encodeURIComponent(projectId)}/video-document`,{
    method:"PUT",credentials:"include",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},body:JSON.stringify(input),signal:AbortSignal.timeout(30_000),
  });
  const body=await response.json();
  if(!response.ok)throw new ProjectContextRequestError(response.status,body.error?.message??"工程同步失败，本机修改仍保留。");
  return projectVideoRevisionSchema.parse(body.data);
}
