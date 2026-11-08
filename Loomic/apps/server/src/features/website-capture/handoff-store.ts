import { createCipheriv,createDecipheriv,randomBytes } from "node:crypto";
import type { Pool } from "pg";
import { websiteHandoffInputSchema,type WebsiteHandoffInput } from "@helstera/shared";

function key(){const bytes=Buffer.from(process.env.WEBSITE_LOGIN_ENCRYPTION_KEY??process.env.PROVIDER_CONFIG_ENCRYPTION_KEY??'', 'base64');if(bytes.length!==32)throw new Error('人工登录加密配置不可用。');return bytes;}
function seal(value:WebsiteHandoffInput,id:string,taskId:string){
  const nonce=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key(),nonce);cipher.setAAD(Buffer.from(`handoff:${id}:${taskId}`));
  const body=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);return Buffer.concat([nonce,cipher.getAuthTag(),body]).toString('base64');
}
function open(value:string,id:string,taskId:string){
  const bytes=Buffer.from(value,'base64'),decipher=createDecipheriv('aes-256-gcm',key(),bytes.subarray(0,12));decipher.setAAD(Buffer.from(`handoff:${id}:${taskId}`));decipher.setAuthTag(bytes.subarray(12,28));
  return websiteHandoffInputSchema.parse(JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)),decipher.final()]).toString('utf8')));
}
export async function queueHandoffInput(db:Pool,owner:{userId:string;workspaceId:string},request:{id:string;viewId:string;frameRevision:number;pageUrl:string;input:WebsiteHandoffInput}){
  const view=(await db.query<{task_id:string}>(`select v.task_id from agent_browser_views v join website_capture_tasks t on t.id=v.task_id
    where v.id=$1 and v.user_id=$2 and v.workspace_id=$3 and v.handoff=true and v.state in ('starting','running','paused')
    and v.heartbeat_at>now()-interval '15 seconds' and v.expires_at>now() and v.url=$4
    and v.frame_revision between $5 and $5+5 and t.status='running' and t.stage='waiting_login'`,[request.viewId,owner.userId,owner.workspaceId,request.pageUrl,request.frameRevision])).rows[0];
  if(!view)throw new Error('登录画面已变化或接管已结束，请刷新后重试。');
  await db.query(`insert into website_handoff_commands(id,view_id,task_id,user_id,ciphertext,page_url) values($1,$2,$3,$4,$5,$6) on conflict(id) do nothing`,[request.id,request.viewId,view.task_id,owner.userId,seal(request.input,request.id,view.task_id),request.pageUrl]);
  return handoffReceipt(db,request.id,owner.userId);
}
export async function handoffReceipt(db:Pool,id:string,userId:string){
  const row=(await db.query<{status:string}>('select status from website_handoff_commands where id=$1 and user_id=$2',[id,userId])).rows[0];
  if(!row)throw new Error('人工操作记录不存在。');return {id,status:row.status};
}
export async function takeHandoffInput(db:Pool,viewId:string){
  const row=(await db.query<{id:string;task_id:string;ciphertext:string;page_url:string}>(`with next as (
    select id,task_id,ciphertext,page_url from website_handoff_commands where view_id=$1 and status='pending' and expires_at>now() order by created_at limit 1 for update skip locked
  ), claimed as(update website_handoff_commands c set status='claimed',ciphertext=null from next where c.id=next.id returning c.id)
  select next.* from next join claimed using(id)`,[viewId])).rows[0];
  if(!row)return null;
  try{return {id:row.id,pageUrl:row.page_url,input:open(row.ciphertext,row.id,row.task_id)};}
  catch{await finishHandoffInput(db,row.id,false);throw new Error('人工操作已失效，请重新操作。');}
}
export async function finishHandoffInput(db:Pool,id:string,success:boolean){await db.query("update website_handoff_commands set status=$2,ciphertext=null where id=$1 and status='claimed'",[id,success?'succeeded':'failed']);}
export async function endHandoff(db:Pool,viewId:string){await db.query("update website_handoff_commands set status='expired',ciphertext=null where view_id=$1 and status in ('pending','claimed')",[viewId]);}
