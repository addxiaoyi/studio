import OpenAI from "openai";

import type {
  GeneratedImage,
  ImageGenerateParams,
  ImageProvider,
  ModelInfo,
} from "../types.js";
import { aspectRatioToDimensions, GenerationError } from "../utils.js";

const ICON_OPENAI =
  "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/openai.svg";

const OPENAI_IMAGE_MODELS: readonly ModelInfo[] = [
  {
    id: "gpt-image-1.5",
    displayName: "GPT Image 1.5",
    description:
      "OpenAI 最新的图像生成模型，最强指令遵循，支持编辑、多参考图、原生文字渲染。",
    iconUrl: ICON_OPENAI,
  },
  {
    id: "gpt-image-1",
    displayName: "GPT Image 1",
    description:
      "OpenAI GPT Image 1，原生对话理解，多模态编辑，支持透明背景 PNG 输出。",
    iconUrl: ICON_OPENAI,
  },
  {
    id: "dall-e-3",
    displayName: "DALL·E 3",
    description:
      "经典 DALL·E 3，长 prompt 理解强，原生 1024x1024 / 1792x1024 / 1024x1792 多种比例。",
    iconUrl: ICON_OPENAI,
  },
];

/** Maps our quality tier to OpenAI's size param. */
const QUALITY_TO_SIZE: Record<string, "1024x1024" | "1024x1792" | "1792x1024"> = {
  standard: "1024x1024",
  hd: "1024x1024",
  ultra: "1792x1024",
};

export class OpenAIImageProvider implements ImageProvider {
  readonly name = "openai";
  readonly models = OPENAI_IMAGE_MODELS;
  private client: OpenAI;

  constructor(apiKey: string, baseURL?: string) {
    this.client = new OpenAI({ apiKey, ...(baseURL ? { baseURL } : {}) });
  }

  async generate(params: ImageGenerateParams): Promise<GeneratedImage> {
    const { width, height } = aspectRatioToDimensions(params.aspectRatio ?? "1:1");
    // OpenAI gpt-image-* supports auto-mapping; DALL·E 3 needs the fixed sizes
    const size = params.model.startsWith("gpt-image")
      ? "auto"
      : (QUALITY_TO_SIZE[params.quality ?? "standard"] ?? "1024x1024");

    try {
      const response = await this.client.images.generate({
        model: params.model,
        prompt: params.prompt,
        size: size as "1024x1024",
        n: 1,
      } as Parameters<typeof this.client.images.generate>[0]);

      // OpenAI types are a union of stream and non-stream; cast to data shape
      const data = response as { data?: Array<{ url?: string; b64_json?: string }> };
      const result = data.data?.[0];
      const url = result?.url;
      if (!url) {
        // gpt-image-* returns base64 by default
        const b64 = result?.b64_json;
        if (b64) {
          return {
            url: `data:image/png;base64,${b64}`,
            mimeType: "image/png",
            width,
            height,
          };
        }
        throw new GenerationError(
          "openai",
          "no_output",
          "OpenAI returned no image data",
        );
      }

      return { url, mimeType: "image/png", width, height };
    } catch (error) {
      if (error instanceof GenerationError) throw error;
      throw new GenerationError(
        "openai",
        "api_error",
        error instanceof Error ? error.message : "Unknown OpenAI error",
      );
    }
  }
}
