import { createCipheriv,createDecipheriv,randomBytes,randomUUID } from "node:crypto";
import type { BrowserContext,Page } from "playwright";
import type { Pool } from "pg";
import { z } from "zod";

type Owner={workspaceId:string;userId:string};
const cookie=z.object({name:z.string(),value:z.string(),domain:z.string(),path:z.string(),expires:z.number(),httpOnly:z.boolean(),secure:z.boolean(),sameSite:z.enum(['Strict','Lax','None'])});
const stateSchema=z.object({cookies:z.array(cookie),origins:z.array(z.object({origin:z.string(),localStorage:z.array(z.object({name:z.string(),value:z.string()}))})),session:z.array(z.tuple([z.string(),z.string()])).default([])});
function key(){const bytes=Buffer.from(process.env.WEBSITE_LOGIN_ENCRYPTION_KEY??process.env.PROVIDER_CONFIG_ENCRYPTION_KEY??'','base64');if(bytes.length!==32)throw new Error('登录会话加密不可用。');return bytes;}
const binding=(owner:Owner,origin:string)=>Buffer.from(`saved-login:${owner.workspaceId}:${owner.userId}:${origin}`);
export async function rememberWebsiteSession(db:Pool,owner:Owner,origin:string,context:BrowserContext,page:Page,allowedOrigins:string[]=[]){
  const state=await context.storageState();const origins=[origin,...allowedOrigins];const hosts=origins.map(value=>new URL(value).hostname);
  const session=await page.evaluate('Object.entries(sessionStorage)') as [string,string][];
  const value=stateSchema.parse({...state,cookies:state.cookies.filter(c=>hosts.some(host=>host===c.domain.replace(/^\./,'')||host.endsWith(c.domain.startsWith('.')?c.domain:`.${c.domain}`))),origins:state.origins.filter(o=>origins.includes(o.origin)),session});
  const nonce=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key(),nonce);cipher.setAAD(binding(owner,origin));
  const encrypted=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);
  const ciphertext=Buffer.concat([nonce,cipher.getAuthTag(),encrypted]).toString('base64');
  const {rows}=await db.query<{id:string}>(`insert into website_browser_sessions(id,workspace_id,user_id,origin,ciphertext,expires_at) values($1,$2,$3,$4,$5,now()+interval '24 hours')
    on conflict(workspace_id,user_id,origin) do update set ciphertext=excluded.ciphertext,expires_at=excluded.expires_at,updated_at=now() returning id`,[randomUUID(),owner.workspaceId,owner.userId,origin,ciphertext]);return rows[0]!.id;
}
export async function restoreWebsiteSession(db:Pool,owner:Owner,origin:string,id:string,context:BrowserContext){
  const row=(await db.query<{ciphertext:string}>("select ciphertext from website_browser_sessions where id=$1 and workspace_id=$2 and user_id=$3 and origin=$4 and expires_at>now() and ciphertext is not null",[id,owner.workspaceId,owner.userId,origin])).rows[0];
  if(!row)throw new Error('记住的登录状态已过期或被清除，请重新登录。');
  try{
    const bytes=Buffer.from(row.ciphertext,'base64'),decipher=createDecipheriv('aes-256-gcm',key(),bytes.subarray(0,12));decipher.setAAD(binding(owner,origin));decipher.setAuthTag(bytes.subarray(12,28));
    const state=stateSchema.parse(JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)),decipher.final()]).toString('utf8')));
    await context.addCookies(state.cookies);
    await context.addInitScript(`(()=>{const state=${JSON.stringify(state)},origin=${JSON.stringify(origin)};if(location.origin!==origin)return;for(const entry of state.origins.find(o=>o.origin===origin)?.localStorage??[])if(localStorage.getItem(entry.name)===null)localStorage.setItem(entry.name,entry.value);for(const [key,value] of state.session)if(sessionStorage.getItem(key)===null)sessionStorage.setItem(key,value);})()`);
  }catch{throw new Error('记住的登录状态无法恢复，请重新登录。');}
}
export async function revokeWebsiteSession(db:Pool,owner:Owner,id:string){
  const client=await db.connect();try{
    await client.query('begin');
    const revoked=await client.query('update website_browser_sessions set ciphertext=null,expires_at=now(),updated_at=now() where id=$1 and workspace_id=$2 and user_id=$3 returning id',[id,owner.workspaceId,owner.userId]);
    if(!revoked.rowCount)throw new Error('网站会话不存在或无权访问。');
    const tasks=await client.query<{id:string;background_job_id:string|null}>("update website_capture_tasks set status='canceled',stage='canceled',error_message='登录会话已撤销，任务停止。',updated_at=now() where (browser_session_id=$1 or login->>'savedSessionId'=$1::text) and workspace_id=$2 and created_by=$3 and status in ('queued','running') returning id,background_job_id",[id,owner.workspaceId,owner.userId]);
    const ids=tasks.rows.map(task=>task.id),jobs=tasks.rows.flatMap(task=>task.background_job_id?[task.background_job_id]:[]);
    if(ids.length){
      await client.query("update website_login_secrets set ciphertext=null where task_id=any($1::uuid[])",[ids]);
      await client.query("update website_handoff_commands set ciphertext=null,status='expired' where task_id=any($1::uuid[]) and status in ('pending','claimed')",[ids]);
      await client.query("update agent_browser_views set state='failed',detail='登录会话已撤销',expires_at=now(),handoff=false where task_id=any($1::uuid[])",[ids]);
    }
    if(jobs.length)await client.query("update background_jobs set status='canceled',canceled_at=now(),updated_at=now() where id=any($1::uuid[]) and status in ('queued','running')",[jobs]);
    await client.query('commit');return {id,canceledTasks:ids.length};
  }catch(error){await client.query('rollback');throw error;}finally{client.release();}
}
export async function assertWebsiteSessionActive(db:Pool,id:string,owner:Owner){
  const {rows}=await db.query('select id from website_browser_sessions where id=$1 and workspace_id=$2 and user_id=$3 and ciphertext is not null and expires_at>now()',[id,owner.workspaceId,owner.userId]);if(!rows[0])throw new Error('登录会话已撤销或过期，任务停止。');
}
