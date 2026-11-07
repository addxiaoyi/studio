import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { videoChatRequestSchema, videoChatResponseSchema, videoChatReplySchema, validateVideoEditorPlan, validateStudioControl } from "@helstera/shared";
import type { FastifyInstance } from "fastify";
import { invokeEditorPlanner, EditorPlannerError } from "../features/video-editor/planner.js";
import { studioChatPrompt } from "../features/video-editor/chat-planner.js";
import type { VideoEditorServices } from "./video-editor.js";
import { extractText, extractJson } from "../features/video-editor/model-json.js";

export function registerVideoChatRoute(app: FastifyInstance, services: VideoEditorServices & Required<Pick<VideoEditorServices,"createPlanModel">>) {
  app.post("/api/video/editor/chat",async(request,reply)=>{
    const user=await services.auth.authenticate(request);
    if(!user)return reply.code(401).send({error:{code:"unauthorized",message:"请先登录工作区。"}});
    const parsed=videoChatRequestSchema.safeParse(request.body);
    if(!parsed.success)return reply.code(400).send({error:{code:"invalid_video_chat",message:"对话或工程信息无效，请重新打开视频。"}});
    const input=parsed.data;
    try {
      const viewer=await services.viewerService.ensureViewer(user);
      const config=await services.settingsService.getChatModelConfig(user,viewer.workspace.id);
      const output=await invokeEditorPlanner(services.createPlanModel(config),[new SystemMessage(studioChatPrompt()),new HumanMessage(JSON.stringify(input))]);
      let answer;
      try {
        answer=videoChatReplySchema.parse(JSON.parse(extractJson(extractText(output))));
        if(answer.plan)validateVideoEditorPlan(answer.plan,input);
        if(answer.control)validateStudioControl(answer.control,input);
      }catch(error){
        request.log.warn({reason:error instanceof Error?error.message.slice(0,500):"invalid output"},"video conversation validation failed");
        return reply.code(422).send({error:{code:"invalid_video_reply",message:"AI 返回了无法安全执行的操作，请调整要求后重试。视频尚未修改。"}});
      }
      if(answer.plan&&!services.planStore)return reply.code(503).send({error:{code:"approval_unavailable",message:"审批服务暂不可用，视频尚未修改。"}});
      const approval=answer.plan?await services.planStore!.save(user.id,viewer.workspace.id,input,answer.plan):undefined;
      return videoChatResponseSchema.parse({source:"model",model:config.model,reply:answer,...(approval?{approval}:{})});
    }catch(error){
      if(error instanceof EditorPlannerError)return reply.code(503).send({error:{code:error.code,message:error.message}});
      request.log.error({type:error instanceof Error?error.name:"unknown"},"video conversation failed");
      return reply.code(503).send({error:{code:"video_chat_unavailable",message:"AI 暂时无法回复，请检查模型配置后重试。视频尚未修改。"}});
    }
  });
}
