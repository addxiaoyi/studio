import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { videoChatRequestSchema, videoChatResponseSchema, videoChatReplySchema, validateVideoEditorPlan, validateStudioControl } from "@helstera/shared";
import type { FastifyInstance } from "fastify";
import { invokeEditorPlanner, EditorPlannerError } from "../features/video-editor/planner.js";
import { studioChatPrompt, useSourceDurations } from "../features/video-editor/chat-planner.js";
import type { VideoEditorServices } from "./video-editor.js";
import { extractText, extractJson } from "../features/video-editor/model-json.js";

export function registerVideoChatRoute(app: FastifyInstance, services: VideoEditorServices & Required<Pick<VideoEditorServices,"createPlanModel">>) {
  app.post("/api/video/editor/chat",async(request,reply)=>{
    const user=await services.auth.authenticate(request);
    if(!user)return reply.code(401).send({error:{code:"unauthorized",message:"请先登录工作区。"}});
    const parsed=videoChatRequestSchema.safeParse(request.body);
    if(!parsed.success)return reply.code(400).send({error:{code:"invalid_video_chat",message:"对话或工程信息无效，请重新打开视频。"}});
    const input=parsed.data;
    let selectedKey:string|undefined;
    try {
      const viewer=await services.viewerService.ensureViewer(user);
      const config=await services.settingsService.getChatModelConfig(user,viewer.workspace.id);
      selectedKey=config.apiKey;
      request.log.info({model:config.model,providerHost:new URL(config.baseUrl??services.env.openAIApiBase??"https://api.openai.com").host},"video conversation started");
      const model=services.createPlanModel(config);
      const structured=model.withStructuredOutput?.(videoChatReplySchema,{name:"video_reply",includeRaw:true,...(config.model.startsWith("google:")?{}:{method:"jsonMode"})});
      const output=await invokeEditorPlanner(structured??model,[new SystemMessage(studioChatPrompt()),new HumanMessage(JSON.stringify(input))],90_000);
      let answer;
      try {
        const structuredReply=structured?output as {parsed:unknown;raw:unknown}:null;
        answer=videoChatReplySchema.parse(structuredReply?.parsed??JSON.parse(extractJson(extractText(structuredReply?.raw??output))));
        if(answer.plan){answer.plan=useSourceDurations(answer.plan,input);validateVideoEditorPlan(answer.plan,input);}
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
      const secrets=[selectedKey,services.env.openAIApiKey,services.env.googleApiKey].filter((key):key is string=>Boolean(key));
      const reason=secrets.reduce((message,key)=>message.replaceAll(key,"[redacted]"),error instanceof Error?error.message:"unknown failure").split("\n")[0]?.slice(0,300);
      request.log.error({type:error instanceof Error?error.name:"unknown",reason},"video conversation failed");
      return reply.code(503).send({error:{code:"video_chat_unavailable",message:"AI 暂时无法回复，请检查模型配置后重试。视频尚未修改。"}});
    }
  });
}
