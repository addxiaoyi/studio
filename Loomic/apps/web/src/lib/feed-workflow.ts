export const FEED_PLATFORMS = ["抖音", "快手", "小红书", "视频号", "知乎", "B站", "公众号"] as const;
export const FEED_GOALS = [
  ["直接转化", "卖点、证据与明确行动指令"],
  ["种草蓄水", "真实体验、场景代入与记忆点"],
  ["新品认知", "快速解释新品是什么、适合谁"],
  ["活动引流", "优惠信息、紧迫感与到店/进店动作"],
] as const;
export const FEED_CONTENT_TYPES = [
  ["种草转化", "突出商品卖点和购买理由"],
  ["痛点对比", "先放大问题，再展示商品解决方案"],
  ["使用场景", "用真实生活场景展示商品价值"],
  ["开箱测评", "快速展示外观、细节和使用体验"],
] as const;
export const FEED_DURATIONS = [4, 5, 6, 8, 10, 12, 15, 20, 25, 30] as const;

type FeedVideoModel = {
  id: string;
  limits?: {
    maxDuration: number;
    allowedDurations?: number[];
  };
};

export function getFeedDurations(
  models: FeedVideoModel[],
  selectedModelId: string,
): number[] {
  if (models.length === 0) return [...FEED_DURATIONS];

  const candidates =
    selectedModelId === "auto"
      ? models
      : models.filter((model) => model.id === selectedModelId);
  const durations = new Set<number>();

  for (const model of candidates) {
    const allowed = model.limits?.allowedDurations;
    if (allowed?.length) {
      for (const duration of allowed) durations.add(duration);
      continue;
    }

    const maxDuration = model.limits?.maxDuration;
    if (maxDuration) {
      for (const duration of FEED_DURATIONS) {
        if (duration <= maxDuration) durations.add(duration);
      }
    }
  }

  return [...durations].sort((a, b) => a - b);
}

export type FeedMode = "feed" | "breakdown";
export type FeedPlatform = (typeof FEED_PLATFORMS)[number];
export type FeedGoal = (typeof FEED_GOALS)[number][0];
export type FeedContentType = (typeof FEED_CONTENT_TYPES)[number][0];

export function buildFeedPrompt(input: {
  mode: FeedMode;
  platform: FeedPlatform;
  goal: FeedGoal;
  contentType: FeedContentType;
  duration: number;
  brief: string;
}) {
  const brief = input.brief.trim() || "请根据上传的商品素材识别并提炼";
  if (input.mode === "breakdown") {
    return `请拆解我上传的信息流素材，并为我的商品生成一套可执行的再生方案。目标平台：${input.platform}；业务目标：${input.goal}；成片时长：${input.duration}秒。请输出：原素材结构、前3秒钩子、镜头节奏、卖点与证据、口播文案、CTA、首帧提示词和可直接生成的视频提示词。只参考结构与节奏，不复制原文案、人物或画面。商品信息与要求：${brief}`;
  }
  return `请为电商商品制作一条${input.platform}信息流内容。业务目标：${input.goal}；内容类型：${input.contentType}；成片时长：${input.duration}秒。必须按以下交付契约完成并逐项确认：1）标题；2）0-3秒钩子；3）分段口播与镜头脚本；4）可信证据点；5）单一CTA；6）只生成一张商品首帧图片；7）使用该首帧生成一条且仅一条${input.duration}秒短视频。结构必须是开头立即给出问题或结果，中段展示场景、卖点与证据，结尾只保留一个明确CTA。生成结束前检查七项是否全部存在，缺失则继续执行，不得只返回计划或说明。不得虚构商品参数，不得擅自生成多个版本。商品卖点和要求：${brief}`;
}
