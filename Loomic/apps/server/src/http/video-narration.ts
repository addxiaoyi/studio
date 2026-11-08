import {createHash,randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import type {FastifyInstance} from 'fastify';
import type {VideoEditorServices} from './video-editor.js';
import {z} from 'zod';
import {synthesizeNarration,type NarrationScript} from '../features/video-editor/narration.js';
const scriptSchema=z.object({text:z.string().trim().min(1).max(2000),voice:z.enum(['cmn','en-us']),rate:z.number().int().min(100).max(220)}).strict();
type VoiceRow=NarrationScript&{id:string;workspace_id:string;user_id:string;fingerprint:string;state:string;asset_id:string|null};
export function registerNarrationRoutes(app:FastifyInstance,services:VideoEditorServices&{synthesize?:(script:NarrationScript)=>Promise<Buffer>}){
 const db=services.browserDb;if(!db)return;
 app.post('/api/video/narration/prepare',async(request,reply)=>{
  const user=await services.auth.authenticate(request);if(!user)return reply.code(401).send({ok:false});
  const parsed=scriptSchema.safeParse(request.body);if(!parsed.success)return reply.code(400).send({ok:false,error:{message:'配音文稿或参数无效。'}});
  const viewer=await services.viewerService.ensureViewer(user),id=randomUUID(),fingerprint=createHash('sha256').update(JSON.stringify(parsed.data)).digest('hex');
  await db.query('insert into video_narration_requests(id,workspace_id,user_id,text,voice,rate,fingerprint) values($1,$2,$3,$4,$5,$6,$7)',[id,viewer.workspace.id,user.id,parsed.data.text,parsed.data.voice,parsed.data.rate,fingerprint]);return {ok:true,data:{id,fingerprint,estimatedCredits:0,engine:'本地基础语音',...parsed.data}};
 });
 app.get<{Params:{id:string}}>('/api/video/narration/:id',async(request,reply)=>{
  const user=await services.auth.authenticate(request);if(!user)return reply.code(401).send({ok:false});const id=z.string().uuid().parse(request.params.id);
  const row=(await db.query('select state,asset_id as "assetId" from video_narration_requests where id=$1 and user_id=$2',[id,user.id])).rows[0];return row?{ok:true,data:row}:reply.code(404).send({ok:false});
 });
 app.post<{Params:{id:string;decision:string}}>('/api/video/narration/:id/:decision',async(request,reply)=>{
  const user=await services.auth.authenticate(request);if(!user)return reply.code(401).send({ok:false});
  const id=z.string().uuid().parse(request.params.id),decision=z.enum(['confirm','reject']).parse(request.params.decision),{fingerprint}=z.object({fingerprint:z.string().regex(/^[a-f0-9]{64}$/)}).parse(request.body);
  const row=(await db.query<VoiceRow>("update video_narration_requests set state=$4 where id=$1 and user_id=$2 and fingerprint=$3 and state='pending' and expires_at>now() returning *",[id,user.id,fingerprint,decision==='confirm'?'running':'rejected'])).rows[0];
  if(!row){const prior=(await db.query('select state,asset_id as "assetId" from video_narration_requests where id=$1 and user_id=$2 and fingerprint=$3',[id,user.id,fingerprint])).rows[0];return prior?{ok:true,data:prior}:reply.code(409).send({ok:false,error:{message:'配音确认已过期或参数改变。'}});}
  if(decision==='reject')return {ok:true,data:{state:'rejected'}};
  try{
   const script=scriptSchema.parse({text:row.text,voice:row.voice,rate:row.rate});if(createHash('sha256').update(JSON.stringify(script)).digest('hex')!==row.fingerprint)throw new Error('配音文稿已改变。');
   const bytes=await(services.synthesize??synthesizeNarration)(script);const assetId=randomUUID(),objectPath=`${row.workspace_id}/narration/${id}.wav`,storageRoot=services.env.storageRoot??'/www/helstera/uploads';
   const path=join(storageRoot,'private-video',objectPath);await mkdir(join(storageRoot,'private-video',row.workspace_id,'narration'),{recursive:true});await writeFile(path,bytes,{mode:0o600});
   const client=await db.connect();try{await client.query('begin');await client.query("insert into asset_objects(id,workspace_id,bucket,object_path,mime_type,byte_size,created_by) values($1,$2,'private-video',$3,'audio/wav',$4,$5)",[assetId,row.workspace_id,objectPath,bytes.length,user.id]);await client.query("update video_narration_requests set state='succeeded',asset_id=$2 where id=$1",[id,assetId]);await client.query('commit');}catch(error){await client.query('rollback');throw error;}finally{client.release();}
   return {ok:true,data:{state:'succeeded',assetId}};
  }catch{await db.query("update video_narration_requests set state='failed' where id=$1",[id]);return reply.code(503).send({ok:false,error:{message:'本地配音未完成，请检查语音引擎后重新准备；没有扣费。'}});}
 });
}
