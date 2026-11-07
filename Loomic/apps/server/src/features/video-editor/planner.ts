import type { BaseLanguageModel } from "@langchain/core/language_models/base";

const PLAN_TIMEOUT_MS = 60_000;

export class EditorPlannerError extends Error {
  constructor(readonly code: "video_plan_timeout" | "video_model_unconfigured", message: string) { super(message); }
}

export function assertPlannerCredential(key: string | undefined) {
  if (!key?.trim() || /placeholder|your[-_ ]?(?:api[-_ ]?)?key|replace[-_ ]?me|changeme/i.test(key)) {
    throw new EditorPlannerError("video_model_unconfigured", "当前 Agent 模型尚未配置有效凭据，请在工作区模型设置中配置后重试。");
  }
}

export async function invokeEditorPlanner<T>(model: {invoke(input:Parameters<BaseLanguageModel["invoke"]>[0],options?:{signal?:AbortSignal}):Promise<T>}, messages: Parameters<BaseLanguageModel["invoke"]>[0], timeoutMs = PLAN_TIMEOUT_MS) {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      const error = new EditorPlannerError("video_plan_timeout", "模型生成计划超时，请检查模型连接后重试。尚未执行编辑。");
      reject(error);
      controller.abort(error);
    }, timeoutMs);
  });
  try {
    // Some provider adapters do not settle promptly after aborting their socket.
    return await Promise.race([model.invoke(messages, { signal: controller.signal }), deadline]);
  } finally {
    clearTimeout(timer);
  }
}
