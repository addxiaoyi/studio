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
];

export class VolcesImageProvider implements ImageProvider {
  readonly name = "volces";
  readonly models = VOLCES_IMAGE_MODELS;
  private apiKey: string;
  private baseURL: string;

  constructor(apiKey: string, baseURL?: string) {
    this.apiKey = apiKey;
    this.baseURL = (baseURL ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  }

  async generate(params: ImageGenerateParams): Promise<GeneratedImage> {
    if (params.inputImages?.length) {
      throw new GenerationError(
        "volces",
        "invalid_input",
        `${params.model} does not support reference images through the Ark image-generation endpoint`,
      );
    }
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
      signal: AbortSignal.timeout(180_000),
    });

    if (!response.ok) {
      const errorBody = await response.json().catch(() => null);
      throw new GenerationError(
        "volces",
        "api_error",
        `Volces API error ${response.status}: ${(errorBody as { error?: { message?: string } })?.error?.message ?? "Unknown error"}`,
      );
    }

    let data: { data?: Array<{ url?: string; b64_json?: string }> };
    try {
      const payload: unknown = await response.json();
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        throw new Error("response body must be an object");
      }
      const candidate = payload as { data?: unknown };
      if (!Array.isArray(candidate.data)) {
        throw new Error("response data must be an array");
      }
      data = candidate as { data: Array<{ url?: string; b64_json?: string }> };
    } catch (error) {
      throw new GenerationError(
        "volces",
        "invalid_provider_response",
        `Volces returned an invalid image response: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const imageData = data.data?.[0];
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
