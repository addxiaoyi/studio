import { z } from "zod";
import { sameWebsiteOrigin } from "./website-login.js";

export const websiteJourneyStepSchema = z.object({
  title: z.string().trim().min(1).max(100),
  url: z.string().url().max(2048).optional(),
  linkText: z.string().trim().min(1).max(100).optional(),
  scroll: z.boolean().default(true),
}).strict().refine(step=>Boolean(step.url)!==Boolean(step.linkText),"每步需要一个网址或页面入口名称。");
export const websiteJourneySchema = z.object({
  goal:z.string().trim().min(1).max(2000),
  summary:z.string().trim().min(1).max(500),
  steps:z.array(websiteJourneyStepSchema).min(1).max(5),
  durationSeconds:z.number().int().min(12).max(60).optional(),
}).strict();
export const websiteJourneyPlanRequestSchema=z.object({url:z.string().url().max(2048),goal:z.string().trim().min(2).max(2000),previous:websiteJourneySchema.optional()}).strict();
export const websiteJourneyPlanSchema=z.object({
  summary:z.string().trim().min(1).max(500),
  steps:z.array(websiteJourneyStepSchema).min(1).max(5),
  recording:z.enum(["browsing","presentation"]),
  durationSeconds:z.number().int().min(12).max(60),
  loginSuggested:z.boolean(),
}).strict();
export type WebsiteJourney=z.infer<typeof websiteJourneySchema>;
export type WebsiteJourneyPlan=z.infer<typeof websiteJourneyPlanSchema>;
export const unsafeWebsiteLink=/(?:logout|signout|delete|remove|purchase|checkout|payment|退出|注销|删除|购买|付款|支付)/i;
export function validateWebsiteJourney(url:string,journey:WebsiteJourney) {
  for(const step of journey.steps){
    if(step.url&&!sameWebsiteOrigin(step.url,url))throw new Error("体验路线只能包含同一 HTTPS 网站内的页面。");
    if(unsafeWebsiteLink.test(step.linkText??step.url??""))throw new Error("体验路线不能包含退出、删除、购买或支付操作。");
  }
}
export const websiteHandoffInputSchema=z.discriminatedUnion("kind",[
  z.object({kind:z.literal("click"),x:z.number().min(0).max(1),y:z.number().min(0).max(1)}).strict(),
  z.object({kind:z.literal("drag"),x:z.number().min(0).max(1),y:z.number().min(0).max(1),toX:z.number().min(0).max(1),toY:z.number().min(0).max(1)}).strict(),
  z.object({kind:z.literal("text"),text:z.string().min(1).max(256)}).strict(),
  z.object({kind:z.literal("key"),key:z.enum(["Tab","Enter","Backspace","Escape","ArrowDown","ArrowUp","ArrowLeft","ArrowRight"])}).strict(),
  z.object({kind:z.literal("scroll"),delta:z.number().int().min(-720).max(720)}).strict(),
  z.object({kind:z.literal("resume")}).strict(),
]);
export type WebsiteHandoffInput=z.infer<typeof websiteHandoffInputSchema>;
export const websiteHandoffRequestSchema=z.object({id:z.string().uuid(),viewId:z.string().uuid(),frameRevision:z.number().int().nonnegative(),pageUrl:z.string().max(2048),input:websiteHandoffInputSchema}).strict();
