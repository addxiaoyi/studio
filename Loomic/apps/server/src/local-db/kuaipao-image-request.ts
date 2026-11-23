import type { ImageGenerateParams } from '../generation/types.js';
import { isKuaipaoImageModel, kuaipaoImageResolution } from '@helstera/shared';

const IMAGE_HOSTS = new Set(['kuaipao.ai', 'kuaipao.pro', 'image.kuaipao.pro']);
const MAX_REFERENCE_IMAGES = 1;

function providerImage(value: string): string {
  const match = value.match(/^data:image\/[a-z0-9.+-]+;base64,(.+)$/i);
  return match?.[1] ?? value;
}

export function kuaipaoImageRequest(baseUrl: string, model: string, params: ImageGenerateParams) {
  const base = new URL(baseUrl);
  if (!IMAGE_HOSTS.has(base.hostname) || !isKuaipaoImageModel(model)) return null;
  // Dedicated image gateway and reference array documented by this provider.
  // https://kuaipao.apifox.cn/539829536e0
  const requestedInputImageCount = params.inputImages?.length ?? 0;
  const inputImages = (params.inputImages ?? []).slice(0, MAX_REFERENCE_IMAGES);
  return {
    url: 'https://image.kuaipao.pro/v2/images/generations',
    body: {
      model, prompt: params.prompt, n: 1, aspect_ratio: params.aspectRatio ?? '1:1',
      resolution: kuaipaoImageResolution(params.quality), response_format: 'b64_json',
      ...(inputImages.length ? { image: inputImages.map(providerImage) } : {}),
    },
    requestedInputImageCount,
    sentInputImageCount: inputImages.length,
  };
}
