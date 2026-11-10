import {randomUUID} from "node:crypto";
import {readFile} from "node:fs/promises";
import Fastify from "fastify";
import {Pool} from "pg";
import {describe,expect,it} from "vitest";
import {registerProjectVideoRoutes} from "../../http/project-video-document.js";

describe.skipIf(!process.env.HELT_TEST_DATABASE_URL)("private video project versions",()=>{
  it("saves metadata without media, deduplicates retries, retains conflicting edits and checks ownership",async()=>{
    const url=new URL(process.env.HELT_TEST_DATABASE_URL!);
    if(url.hostname!=="127.0.0.1")throw new Error("Local database required");
    const admin=new Pool({connectionString:url.href}),schema=`video_document_${randomUUID().replaceAll("-","")}`;
    await admin.query(`create schema ${schema}`);
    const db=new Pool({connectionString:url.href,options:`-c search_path=${schema},public`}),app=Fastify();
    try {
      await db.query(await readFile(new URL("../../local-db/schema.sql",import.meta.url),"utf8"));
      await db.query(await readFile(new URL("../../local-db/migrations/20261110000002_project_video_documents.sql",import.meta.url),"utf8"));
      const user=randomUUID(),peer=randomUUID(),workspace=randomUUID(),project=randomUUID();
      await db.query("insert into app_users(id,email) values($1,'video-owner@test.invalid'),($2,'video-peer@test.invalid')",[user,peer]);
      await db.query("insert into workspaces(id,owner_user_id,name) values($1,$2,'videos')",[workspace,user]);
      await db.query("insert into projects(id,workspace_id,created_by,name,slug) values($1,$2,$3,'剪辑工程','video')",[project,workspace,user]);
      registerProjectVideoRoutes(app,{db,auth:{authenticate:async req=>req.headers.authorization?{id:req.headers.authorization} as never:null}});
      const path=`/api/projects/${project}/video-document`;
      const document={version:1,entryPoint:"/project/src/index.ts",rootDir:"/project",files:{"/project/src/index.ts":"export const title='原版本';"},assets:[],state:{}};
      const input={document,syncEnabled:true,expectedRevision:0,mutationId:randomUUID()};
      const put=(payload:Record<string,unknown>,owner=user)=>app.inject({method:"PUT",url:path,headers:{authorization:owner},payload});
      expect((await app.inject(path)).statusCode).toBe(401);
      expect((await app.inject({url:path,headers:{authorization:peer}})).statusCode).toBe(404);
      const replies=await Promise.all([put(input),put(input)]);
      for(const reply of replies)expect(reply.statusCode,reply.body).toBe(200);
      expect(replies[0]!.json().data.revision).toBe(1);
      expect(replies[1]!.json().data).toEqual(replies[0]!.json().data);
      expect((await db.query("select count(*)::int as count from project_video_versions")).rows[0].count).toBe(1);
      const changed={...input,document:{...document,files:{"/project/src/index.ts":"export const title='新版本';"}}};
      expect((await put(changed)).statusCode).toBe(409);
      expect((await put({...changed,mutationId:randomUUID()})).json().error.code).toBe("project_document_conflict");
      expect((await put({...changed,mutationId:randomUUID(),expectedRevision:1})).json().data.revision).toBe(2);
      const history=await app.inject({url:path+"/versions",headers:{authorization:user}});
      expect(history.json().data.map((row:{revision:number})=>row.revision)).toEqual([2,1]);
      const old=await app.inject({url:path+"?revision=1",headers:{authorization:user}});
      expect(old.json().data.document.files["/project/src/index.ts"]).toContain("原版本");
      expect((await put({...input,expectedRevision:2,mutationId:randomUUID(),syncEnabled:false})).json().data.syncEnabled).toBe(false);
      const denied={...input,expectedRevision:3,mutationId:randomUUID(),document:{...document,assets:[{name:"private.mp4",size:1,mimeType:"video/mp4",assetId:randomUUID(),sha256:null}]}};
      expect((await put(denied)).statusCode).toBe(409);
      expect((await app.inject({url:path,headers:{authorization:user}})).json().data.revision).toBe(3);
      expect((await put({...input,document:{...document,publicFiles:{"private.mp4":[1,2,3]}}})).statusCode).toBe(400);
      expect((await put({...input,document:{...document,files:{"/project/../escape":"bad"}}})).statusCode).toBe(400);
      expect((await db.query("select count(*)::int as count from asset_objects")).rows[0].count).toBe(0);
    } finally {await app.close();await db.end();await admin.query(`drop schema ${schema} cascade`);await admin.end();}
  });
});
