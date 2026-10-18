import { createMiddleware, ToolMessage } from "langchain";

import { buildImageGenerateSchema } from "./tools/image-generate.js";

const imageInput = buildImageGenerateSchema([]);

export const imageInputMiddleware = createMiddleware({
  name: "ImageInputValidation",
  wrapToolCall: async (request, handler) => {
    if (request.toolCall.name !== "generate_image") return handler(request);

    const parsed = imageInput.safeParse(request.toolCall.args);
    if (parsed.success) return handler(request);

    // A malformed sibling call must not abort an already paid generation.
    const fields = [...new Set(parsed.error.issues.map((issue) => issue.path.join(".")))];
    console.warn("[image-input] Rejected invalid tool arguments", {
      toolCallId: request.toolCall.id, fields,
    });
    return new ToolMessage({
      tool_call_id: request.toolCall.id!,
      name: request.toolCall.name,
      status: "error",
      content: JSON.stringify({
        code: "invalid_input",
        error: `图片工具参数缺失或格式不正确：${fields.join("、")}。本次调用未提交任务、未扣费。`,
        summary: "如果本轮其他调用已提交图片任务，请等待并使用其结果，不要再次生成。只有尚未提交任务时，才根据用户真实需求补全参数；不要编造默认提示词。",
      }),
    });
  },
});
