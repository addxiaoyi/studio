import { createCipheriv,createDecipheriv,randomBytes,randomUUID } from "node:crypto";
import type { BrowserContext,Page } from "playwright";
import type { Pool } from "pg";
import { z } from "zod";

type Owner={workspaceId:string;userId:string};
const cookie=z.object({name:z.string(),value:z.string(),domain:z.string(),path:z.string(),expires:z.number(),httpOnly:z.boolean(),secure:z.boolean(),sameSite:z.enum(['Strict','Lax','None'])});
const stateSchema=z.object({cookies:z.array(cookie),origins:z.array(z.object({origin:z.string(),localStorage:z.array(z.object({name:z.string(),value:z.string()}))})),session:z.array(z.tuple([z.string(),z.string()])).default([])});
function key(){const bytes=Buffer.from(process.env.WEBSITE_LOGIN_ENCRYPTION_KEY??process.env.PROVIDER_CONFIG_ENCRYPTION_KEY??'','base64');if(bytes.length!==32)throw new Error('登录会话加密不可用。');return bytes;}
const binding=(owner:Owner,origin:string)=>Buffer.from(`saved-login:${owner.workspaceId}:${owner.userId}:${origin}`);
export async function rememberWebsiteSession(db:Pool,owner:Owner,origin:string,context:BrowserContext,page:Page){
  const state=await context.storageState();const host=new URL(origin).hostname;
  const session=await page.evaluate('Object.entries(sessionStorage)') as [string,string][];
  const value=stateSchema.parse({...state,cookies:state.cookies.filter(c=>host===c.domain.replace(/^\./,'')||host.endsWith(c.domain.startsWith('.')?c.domain:`.${c.domain}`)),origins:state.origins.filter(o=>o.origin===origin),session});
  const nonce=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key(),nonce);cipher.setAAD(binding(owner,origin));
  const encrypted=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);
  const ciphertext=Buffer.concat([nonce,cipher.getAuthTag(),encrypted]).toString('base64');
  await db.query(`insert into website_browser_sessions(id,workspace_id,user_id,origin,ciphertext,expires_at) values($1,$2,$3,$4,$5,now()+interval '24 hours')
    on conflict(workspace_id,user_id,origin) do update set ciphertext=excluded.ciphertext,expires_at=excluded.expires_at,updated_at=now()`,[randomUUID(),owner.workspaceId,owner.userId,origin,ciphertext]);
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
