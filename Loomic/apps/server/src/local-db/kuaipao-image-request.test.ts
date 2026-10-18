import { expect, it } from 'vitest';
import { kuaipaoImageRequest } from './kuaipao-image-request.js';

it('uses the documented gateway and reference field without changing prompt or model', () => {
  const params = { model: 'gpt-image-2', prompt: '只生成一张原商品海报', inputImages: ['data:image/png;base64,cGlj'] };
  const request = kuaipaoImageRequest('https://kuaipao.ai/v1', params.model, params);
  expect(request?.url).toBe('https://image.kuaipao.pro/v1/images/generations');
  expect(request?.body).toMatchObject({ model: params.model, prompt: params.prompt, image: ['cGlj'], n: 1 });
  expect(request?.body).not.toHaveProperty('input_images');
});

it('does not add fake references to a text-only request', () => {
  expect(kuaipaoImageRequest('https://image.kuaipao.pro/v1', 'gpt-image-2', { model: 'gpt-image-2', prompt: 'cup' })?.body)
    .not.toHaveProperty('image');
});

it('sends only one reference image to the synchronous gateway', () => {
  const request = kuaipaoImageRequest('https://kuaipao.ai/v1', 'gpt-image-2.5-2k', {
    model: 'gpt-image-2.5-2k',
    prompt: 'poster edit',
    inputImages: [
      'data:image/png;base64,Zmlyc3Q=',
      'data:image/png;base64,c2Vjb25k',
    ],
  });

  expect(request).toMatchObject({ requestedInputImageCount: 2, sentInputImageCount: 1 });
  expect(request?.body.image).toEqual(['Zmlyc3Q=']);
});

it('maps the requested aspect ratio to provider dimensions', () => {
  const request = kuaipaoImageRequest('https://kuaipao.ai/v1', 'gpt-image-2', {
    model: 'gpt-image-2',
    prompt: 'portrait product poster',
    aspectRatio: '9:16',
  });

  expect(request?.body.size).toBe('576x1024');
});

it.each(['https://another-provider.test/v1', 'https://kuaipao.ai.attacker.test/v1'])(
  'does not redirect unrelated channels: %s', (url) => {
    expect(kuaipaoImageRequest(url, 'gpt-image-2', { model: 'gpt-image-2', prompt: 'cup' })).toBeNull();
  },
);
