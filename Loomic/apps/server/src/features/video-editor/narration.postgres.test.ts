import {randomUUID} from 'node:crypto';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import Fastify from 'fastify';
import {Pool} from 'pg';
import {expect,it,vi} from 'vitest';
import {registerNarrationRoutes} from '../../http/video-narration.js';
const database=process.env.HELT_TEST_DATABASE_URL;
it.skipIf(!database)('requires exact approval, rejects without synthesis and never repeats a consumed narration',async()=>{
 const admin=new Pool({connectionString:database}),schema=`voice_${randomUUID().replaceAll('-','')}`,userId=randomUUID(),workspaceId=randomUUID(),root=await mkdtemp(join(tmpdir(),'voice-test-'));
 await admin.query(`create schema ${schema}`);const db=new Pool({connectionString:database,options:`-c search_path=${schema}`});const app=Fastify();
 try{
  await db.query('create table workspaces(id uuid primary key);create table app_users(id uuid primary key);create table asset_objects(id uuid primary key,workspace_id uuid,bucket text,object_path text,mime_type text,byte_size int,created_by uuid);create table website_browser_sessions(id uuid primary key);create table website_capture_tasks(id uuid primary key,status text);create table agent_browser_views(id uuid primary key)');
  await db.query('insert into workspaces values($1)',[workspaceId]);await db.query('insert into app_users values($1)',[userId]);await db.query(await readFile(new URL('../../local-db/migrations/20261108000003_website_session_revocation.sql',import.meta.url),'utf8'));
  const synthesize=vi.fn(async()=>Buffer.from('RIFF'+'.'.repeat(100)));
  registerNarrationRoutes(app,{auth:{authenticate:async()=>({id:userId})} as never,viewerService:{ensureViewer:async()=>({workspace:{id:workspaceId}})} as never,browserDb:db,env:{storageRoot:root} as never,settingsService:{} as never,synthesize});
  const input={text:'这是网站介绍。',voice:'cmn',rate:150};
  const rejected=(await app.inject({method:'POST',url:'/api/video/narration/prepare',payload:input})).json().data;
  await app.inject({method:'POST',url:`/api/video/narration/${rejected.id}/reject`,payload:{fingerprint:rejected.fingerprint}});expect(synthesize).not.toHaveBeenCalled();
  const altered=(await app.inject({method:'POST',url:'/api/video/narration/prepare',payload:input})).json().data;await db.query("update video_narration_requests set text='changed' where id=$1",[altered.id]);
  expect((await app.inject({method:'POST',url:`/api/video/narration/${altered.id}/confirm`,payload:{fingerprint:altered.fingerprint}})).statusCode).toBe(503);expect(synthesize).not.toHaveBeenCalled();
  const quote=(await app.inject({method:'POST',url:'/api/video/narration/prepare',payload:input})).json().data;
  expect((await app.inject({method:'POST',url:`/api/video/narration/${quote.id}/confirm`,payload:{fingerprint:'0'.repeat(64)}})).statusCode).toBe(409);
  const confirmations=await Promise.all([1,2].map(()=>app.inject({method:'POST',url:`/api/video/narration/${quote.id}/confirm`,payload:{fingerprint:quote.fingerprint}})));
  expect(confirmations.every(response=>response.statusCode===200)).toBe(true);expect(synthesize).toHaveBeenCalledTimes(1);
  const finished=(await app.inject({method:'GET',url:`/api/video/narration/${quote.id}`})).json().data;expect(finished.state).toBe('succeeded');expect(finished.assetId).toBeTruthy();
 }finally{await app.close();await db.end();await admin.query(`drop schema ${schema} cascade`);await admin.end();await rm(root,{recursive:true,force:true});}
});
