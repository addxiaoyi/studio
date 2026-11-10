import type {FastifyInstance} from "fastify";
import type {Pool} from "pg";
import {z} from "zod";
import {projectVideoWriteSchema} from "@helstera/shared";
import type {RequestAuthenticator} from "../auth/types.js";
import {ProjectContextError} from "../features/projects/project-context.js";
import {listVideoVersions,readVideoDocument,writeVideoDocument} from "../features/projects/video-document.js";

const projectParams=z.object({projectId:z.string().uuid()});
const versionQuery=z.object({revision:z.coerce.number().int().positive().optional()}).strict();

export function registerProjectVideoRoutes(app:FastifyInstance,options:{db:Pool;auth:RequestAuthenticator}) {
  app.route({method:["GET","PUT"],url:"/api/projects/:projectId/video-document",bodyLimit:2*1024*1024,
    async handler(request,reply) {
      const user=await options.auth.authenticate(request);
      if(!user)return reply.code(401).send({ok:false,error:{code:"unauthorized",message:"请先登录。"}});
      const params=projectParams.safeParse(request.params),query=versionQuery.safeParse(request.query);
      if(!params.success||!query.success)return reply.code(400).send({ok:false,error:{code:"invalid_project_version",message:"工程或版本参数无效。"}});
      try {
        let saved;
        if(request.method==="PUT") {
          const parsed=projectVideoWriteSchema.safeParse(request.body);
          if(!parsed.success)return reply.code(400).send({ok:false,error:{code:"invalid_project_document",message:"工程描述格式无效。仅同步源文件和素材引用，不接受媒体原文件。"}});
          saved=await writeVideoDocument(options.db,user.id,params.data.projectId,parsed.data);
        } else saved=await readVideoDocument(options.db,user.id,params.data.projectId,query.data.revision);
        return reply.header("Cache-Control","private, no-store").send({ok:true,data:saved});
      } catch(error) {
        if(!(error instanceof ProjectContextError))request.log.error({err:error},"Video project document could not be saved or restored");
        return reply.code(error instanceof ProjectContextError?error.status:500).send({ok:false,error:{
          code:error instanceof ProjectContextError?error.code:"project_document_failed",message:error instanceof ProjectContextError?error.message:"工程同步失败，本机修改仍保留，请重试。",
        }});
      }
    },
  });
  app.get("/api/projects/:projectId/video-document/versions",async(request,reply)=>{
    const user=await options.auth.authenticate(request);
    if(!user)return reply.code(401).send({ok:false,error:{code:"unauthorized",message:"请先登录。"}});
    const params=projectParams.safeParse(request.params);
    if(!params.success)return reply.code(400).send({ok:false,error:{code:"invalid_project",message:"工程标识无效。"}});
    try {return reply.header("Cache-Control","private, no-store").send({ok:true,data:await listVideoVersions(options.db,user.id,params.data.projectId)});}
    catch(error) {
      if(!(error instanceof ProjectContextError))request.log.error({err:error},"Video project versions could not be read");
      return reply.code(error instanceof ProjectContextError?error.status:500).send({ok:false,error:{code:"project_versions_unavailable",message:error instanceof ProjectContextError?error.message:"暂时无法读取工程版本，请重试。"}});
    }
  });
}
