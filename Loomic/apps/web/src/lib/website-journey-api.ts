import type { WebsiteJourney,WebsiteJourneyPlan } from "@helstera/shared";
import { getServerBaseUrl } from "./env";
const headers=(token:string)=>({'Content-Type':'application/json',...(token==='local-cookie'?{}:{Authorization:`Bearer ${token}`})});
async function call<T>(token:string,path:string,method:string,body?:unknown):Promise<T>{
  const requestHeaders:Record<string,string>=headers(token);if(!body)delete requestHeaders['Content-Type'];
  const response=await fetch(`${getServerBaseUrl()}/api/website-capture/${path}`,{method,credentials:'include',cache:'no-store',redirect:'error',headers:requestHeaders,...(body?{body:JSON.stringify(body)}:{})});
  const payload=await response.json();if(!response.ok)throw new Error(payload.error?.message??'网站体验请求未完成，请重试。');return payload.data;
}
export function planWebsiteJourney(token:string,input:{url:string;goal:string;previous?:WebsiteJourney}){return call<{source:'model';model:string;plan:WebsiteJourneyPlan;observedLinks:number}>(token,'plan','POST',input);}
export type SavedWebsiteSession={id:string;origin:string;expiresAt:string;updatedAt?:string;activeTasks?:number};
export function listWebsiteSessions(token:string){return call<SavedWebsiteSession[]>(token,'login-sessions','GET');}
export function forgetWebsiteSession(token:string,id:string){return call<void>(token,`login-sessions/${id}`,'DELETE');}
