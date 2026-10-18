import type { ImageGenerateParams } from '../generation/types.js';
import { aspectRatioToDimensions } from '../generation/utils.js';

const IMAGE_HOSTS = new Set(['kuaipao.ai', 'kuaipao.pro', 'image.kuaipao.pro']);
const MAX_REFERENCE_IMAGES = 1;

function providerImage(value: string): string {
  const match = value.match(/^data:image\/[a-z0-9.+-]+;base64,(.+)$/i);
  return match?.[1] ?? value;
}

export function kuaipaoImageRequest(baseUrl: string, model: string, params: ImageGenerateParams) {
  const base = new URL(baseUrl);
  if (!IMAGE_HOSTS.has(base.hostname) || !model.startsWith('gpt-image-')) return null;
  // Dedicated image gateway and reference array documented by this provider.
  // https://kuaipao.apifox.cn/api-504829256
  const { width, height } = aspectRatioToDimensions(params.aspectRatio ?? '1:1');
  const requestedInputImageCount = params.inputImages?.length ?? 0;
  const inputImages = (params.inputImages ?? []).slice(0, MAX_REFERENCE_IMAGES);
  return {
    url: 'https://image.kuaipao.pro/v1/images/generations',
    body: {
      model, prompt: params.prompt, n: 1, size: `${width}x${height}`, response_format: 'b64_json',
      ...(inputImages.length ? { image: inputImages.map(providerImage) } : {}),
    },
    requestedInputImageCount,
    sentInputImageCount: inputImages.length,
  };
}
