import { createHash } from "node:crypto";
import { readFile, realpath, rename, writeFile } from "node:fs/promises";
import { basename, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { createPublicMediaClient, parsePublicManifest, type PublicMedia } from "./public-media.js";

export async function publishPublicMedia(root: string, output: string, videos: string[] = []) {
  const directory = await realpath(root);
  const catalog: Array<{ image: string; thumb: string }> = JSON.parse(await readFile(resolve(directory, "catalog.json"), "utf8"));
  const files = new Map<string, string>();
  for (const outfit of catalog) for (const path of [outfit.image, outfit.thumb]) {
    if (!/^(?:img|thumbs)\/[A-Z0-9_-]+\.webp$/.test(path)) throw new Error(`Invalid gallery path: ${path}`);
    const fullPath = await realpath(resolve(directory, path));
    if (!fullPath.startsWith(directory + sep)) throw new Error("Gallery asset escapes its public directory");
    files.set(`fashion-gallery/${path}`, fullPath);
  }
  // Videos are opt-in operator inputs; never scan uploads or private asset directories.
  for (const path of videos) {
    if (!/\.(mp4|webm)$/i.test(path)) throw new Error("Only explicitly approved MP4/WebM videos may be published");
    const fullPath = await realpath(path);
    const bytes = await readFile(fullPath);
    const digest = createHash("sha256").update(bytes).digest("hex");
    files.set(`public-videos/${digest}.${path.toLowerCase().endsWith(".mp4") ? "mp4" : "webm"}`, fullPath);
  }
  const { client, bucket } = createPublicMediaClient();
  const manifest: Record<string, PublicMedia> = {};
  let completed = 0;
  const queue = [...files];
  try {
    await Promise.all(Array.from({ length: 4 }, async () => {
      while (queue.length) {
        const item = queue.shift();
        if (!item) return;
        const [path, file] = item;
        const bytes = await readFile(file);
        if (!bytes.length || bytes.length > 250 * 1024 * 1024) throw new Error(`Invalid public asset size: ${path}`);
        const sha256 = createHash("sha256").update(bytes).digest("hex");
        const mime = path.endsWith(".webp") ? "image/webp" : path.endsWith(".mp4") ? "video/mp4" : "video/webm";
        const key = `loomic-public/${sha256}/${basename(path)}`;
        let exists = false;
        try {
          const stored = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
          exists = stored.ContentLength === bytes.length && stored.Metadata?.sha256 === sha256;
        } catch (error) {
          if ((error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode !== 404) throw error;
        }
        if (!exists) await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: bytes, ContentType: mime, Metadata: { sha256 }, CacheControl: "public, max-age=31536000, immutable" }));
        const stored = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        if (!stored.Body) throw new Error(`Missing uploaded object: ${path}`);
        const downloaded = await stored.Body.transformToByteArray();
        if (createHash("sha256").update(downloaded).digest("hex") !== sha256) throw new Error(`Public asset verification failed: ${path}`);
        manifest[path] = { key, sha256, bytes: bytes.length, mime };
        completed += 1;
        if (completed % 100 === 0) console.log(`Verified ${completed}/${files.size} public assets`);
      }
    }));
    parsePublicManifest(manifest);
    const temporary = `${output}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(manifest, null, 2) + "\n", { mode: 0o644, flag: "wx" });
    await rename(temporary, output);
    console.log(`Published and SHA-256 verified ${completed} public assets`);
  } finally { client.destroy(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [, , root, output, ...videos] = process.argv;
  if (!root || !output) throw new Error("Usage: publish-public-media.ts GALLERY_ROOT MANIFEST [APPROVED_PUBLIC_VIDEO ...]");
  await publishPublicMedia(root, output, videos);
}
