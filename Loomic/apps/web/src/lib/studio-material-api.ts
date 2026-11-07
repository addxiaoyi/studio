import {jobResponseSchema} from "@helstera/shared";
import {ApiApplicationError} from "./server-api";
import {getServerBaseUrl} from "./env";
import type {StudioVideoRequest} from "./studio-video-generation";

export async function submitMaterialVideo(token:string,request:StudioVideoRequest){
  const {draft}=request;
  const response=await fetch(`${getServerBaseUrl()}/api/jobs/video-generation`,{method:"POST",credentials:"include",headers:{authorization:`Bearer ${token}`,"content-type":"application/json","idempotency-key":request.key,"x-generation-confirmation":"required"},body:JSON.stringify({prompt:draft.prompt,model:draft.model,duration:draft.duration,resolution:draft.resolution,aspect_ratio:draft.aspectRatio})});
  if(!response.headers.get("content-type")?.includes("application/json"))throw new Error("生成服务响应异常，请恢复原任务查询结果。");
  const payload=await response.json();
  if(!response.ok)throw new ApiApplicationError(payload.error?.code??"video_generation_failed",payload.error?.message??"生成请求失败，请恢复原任务。",payload.data??payload.error?.details,{statusCode:response.status});
  return jobResponseSchema.parse(payload);
}
