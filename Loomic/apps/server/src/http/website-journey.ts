import type { FastifyInstance } from "fastify";
import { websiteJourneyPlanRequestSchema } from "@helstera/shared";
import type { VideoEditorServices } from "./video-editor.js";
import { observeJourneySite,planWebsiteJourney,type JourneySite } from "../features/website-capture/journey-planner.js";
import { assertConnectorEnabled } from "../features/agent-goals/connector-gate.js";

export function registerWebsiteJourneyRoutes(app:FastifyInstance,services:VideoEditorServices&Required<Pick<VideoEditorServices,"createPlanModel">>&{observeSite?:(url:string)=>Promise<JourneySite>}){
  app.post('/api/website-capture/plan',async(request,reply)=>{
    const user=await services.auth.authenticate(request);
    if(!user)return reply.code(401).send({ok:false,error:{code:'unauthorized',message:'请先登录工作区。'}});
    const parsed=websiteJourneyPlanRequestSchema.safeParse(request.body);
    if(!parsed.success)return reply.code(400).send({ok:false,error:{code:'invalid_goal',message:'请填写网站地址和想体验的内容。'}});
    try{
      const viewer=await services.viewerService.ensureViewer(user);
      if(!services.browserDb)throw new Error('浏览器规划服务不可用');
      await assertConnectorEnabled(services.browserDb,viewer.workspace.id,user.id,'isolated-browser');
      const config=await services.settingsService.getChatModelConfig(user,viewer.workspace.id);
      const site=await(services.observeSite??observeJourneySite)(parsed.data.url);
      const plan=await planWebsiteJourney(services.createPlanModel(config),parsed.data,site);
      return {ok:true,data:{source:'model',model:config.model,plan,observedLinks:site.links.length}};
    }catch{
      return reply.code(503).send({ok:false,error:{code:'journey_plan_unavailable',message:'暂时无法读取网站或生成体验路线。请检查网址与 Agent 模型配置后重试，尚未登录或录制。'}});
    }
  });
}
