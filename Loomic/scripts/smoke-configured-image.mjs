import { writeFile } from 'node:fs/promises';
import pg from 'pg';
import sharp from 'sharp';
import { generateConfiguredImage } from '../src/local-db/provider-generation.ts';

const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const nativeFetch = globalThis.fetch;
let upstreamCalls = 0;
globalThis.fetch = (url, options = {}) => {
  if (options.method === 'POST') upstreamCalls += 1;
  return nativeFetch(url, { ...options, signal: AbortSignal.timeout(180_000) });
};
const singleChannel = {
  async query(sql, values) {
    const rows = await db.query(sql, values);
    return sql.includes('select pc.id, pm.id as provider_model_id')
      ? { ...rows, rows: rows.rows.slice(0, 1) } : rows;
  },
};
const started = Date.now();
try {
  const image = await generateConfiguredImage(singleChannel, 'gpt-image-2', {
    model: 'gpt-image-2',
    prompt: 'Create exactly one ecommerce hero photograph of a plain white ceramic mug on a light gray studio background. Soft natural lighting, centered product, no text, no collage.',
    aspectRatio: '1:1',
  });
  if (!image) throw Object.assign(new Error('No callable configured channel'), { code: 'no_channel' });
  const response = await fetch(image.url);
  if (!response.ok) throw new Error(`Image download returned ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const info = await sharp(bytes).metadata();
  if (!info.width || !info.height) throw new Error('Output is not a decodable image');
  const path = `/tmp/helstera-image-smoke-${Date.now()}.${info.format}`;
  await writeFile(path, bytes);
  console.log(JSON.stringify({ ok: true, model: 'gpt-image-2', path, bytes: bytes.length, width: info.width, height: info.height, format: info.format, upstreamCalls, elapsedMs: Date.now() - started }));
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.log(JSON.stringify({ ok: false, model: 'gpt-image-2', code: error.code ?? 'probe_failed', status: message.match(/provider returned ([0-9]{3})/)?.[1], refusal: /安全政策|内容策略|不适合生成/.test(message), timeout: /timeout|timed out|504/i.test(message), upstreamCalls, elapsedMs: Date.now() - started }));
  process.exitCode = 1;
} finally {
  globalThis.fetch = nativeFetch;
  await db.end();
}
