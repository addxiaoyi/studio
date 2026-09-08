import type {
  GeneratedImage,
  ImageGenerateParams,
  ImageProvider,
  ModelInfo,
} from "../types.js";
import { aspectRatioToDimensions, GenerationError } from "../utils.js";

const DEFAULT_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3";

const ICON_VOLCES =
  "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/doubao.svg";

const VOLCES_IMAGE_MODELS: readonly ModelInfo[] = [
  {
    id: "doubao-seedream-3-0-t2i-250415",
    displayName: "Seedream 3.0",
    description:
      "豆包 Seedream 3.0 文字生图模型，中文 prompt 理解优秀，支持 1024–2048 多种分辨率。",
    iconUrl: ICON_VOLCES,
  },
  {
    id: "doubao-seededit-3-0-i2i-250628",
    displayName: "SeedEdit 3.0",
    description:
      "豆包 SeedEdit 3.0 图像编辑模型，支持图生图 + 自然语言编辑指令，保留原图主体。",
    iconUrl: ICON_VOLCES,
  },
  {
    id: "high_aes_general_v30l_zt2i",
    displayName: "通用 3.0",
    description:
      "字节跳动高质感通用图像生成模型，适合海报、商品图、品牌素材场景。",
    iconUrl: ICON_VOLCES,
  },
];

export class VolcesImageProvider implements ImageProvider {
  readonly name = "volces";
  readonly models = VOLCES_IMAGE_MODELS;
  private apiKey: string;
  private baseURL: string;

  constructor(apiKey: string, baseURL?: string) {
    this.apiKey = apiKey;
    this.baseURL = baseURL ?? DEFAULT_BASE_URL;
  }

  async generate(params: ImageGenerateParams): Promise<GeneratedImage> {
    const { width, height } = aspectRatioToDimensions(params.aspectRatio ?? "1:1");
    const size = `${width}x${height}`;

    const body = {
      model: params.model,
      prompt: params.prompt,
      size,
      n: 1,
      response_format: "url",
    };

    const response = await fetch(`${this.baseURL}/images/generations`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorBody = await response.json().catch(() => null);
      throw new GenerationError(
        "volces",
        "api_error",
        `Volces API error ${response.status}: ${(errorBody as { error?: { message?: string } })?.error?.message ?? "Unknown error"}`,
      );
    }

    const data = (await response.json()) as {
      data: Array<{ url?: string; b64_json?: string }>;
    };
    const imageData = data.data[0];
    let url = imageData?.url;
    if (!url && imageData?.b64_json) {
      url = `data:image/png;base64,${imageData.b64_json}`;
    }
    if (!url) {
      throw new GenerationError("volces", "no_output", "Volces returned no image data");
    }

    return { url, mimeType: "image/png", width, height };
  }
}
