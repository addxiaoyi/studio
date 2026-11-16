import { readFileSync } from "node:fs";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { z } from "zod";
import { createLocalPublicMedia } from "./local-public-media.js";

const mediaEntry = z
  .object({
    key: z.string().regex(/^loomic-public\/[a-f0-9]{64}\/[a-zA-Z0-9._-]+$/),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    bytes: z
      .number()
      .int()
      .positive()
      .max(250 * 1024 * 1024),
    mime: z.enum(["image/webp", "video/mp4", "video/webm"]),
  })
  .strict();
export type PublicMedia = z.infer<typeof mediaEntry>;

export function parsePublicManifest(value: unknown): Map<string, PublicMedia> {
  const entries = z.record(z.string(), mediaEntry).parse(value);
  const manifest = new Map<string, PublicMedia>();
  for (const [path, entry] of Object.entries(entries)) {
    const image = /^fashion-gallery\/(?:img|thumbs)\/[A-Z0-9_-]+\.webp$/.test(
      path,
    );
    const video = /^public-videos\/[a-f0-9]{64}\.(?:mp4|webm)$/.test(path);
    if (
      (!image && !video) ||
      (image && entry.mime !== "image/webp") ||
      (video &&
        entry.mime !== (path.endsWith(".mp4") ? "video/mp4" : "video/webm")) ||
      entry.key.split("/")[1] !== entry.sha256
    ) {
      throw new Error(`Invalid public media manifest entry: ${path}`);
    }
    manifest.set(path, entry);
  }
  if (!manifest.size) throw new Error("Public media manifest is empty");
  return manifest;
}

export function createPublicMediaClient(env: NodeJS.ProcessEnv = process.env) {
  const { QINIU_ACCESS_KEY, QINIU_SECRET_KEY, QINIU_PUBLIC_BUCKET } = env;
  if (!QINIU_ACCESS_KEY || !QINIU_SECRET_KEY || !QINIU_PUBLIC_BUCKET)
    throw new Error("Qiniu public media credentials are incomplete");
  if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(QINIU_PUBLIC_BUCKET))
    throw new Error("Invalid Qiniu public bucket");
  const region = env.QINIU_REGION ?? "cn-east-1";
  if (
    ![
      "cn-east-1",
      "cn-east-2",
      "cn-north-1",
      "cn-south-1",
      "us-north-1",
      "ap-southeast-1",
      "ap-southeast-2",
      "ap-southeast-3",
    ].includes(region)
  )
    throw new Error("Invalid Qiniu region");
  const client = new S3Client({
    endpoint: `https://s3.${region}.qiniucs.com`,
    region,
    forcePathStyle: true,
    credentials: {
      accessKeyId: QINIU_ACCESS_KEY,
      secretAccessKey: QINIU_SECRET_KEY,
    },
    maxAttempts: 2,
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
  return { client, bucket: QINIU_PUBLIC_BUCKET };
}

export function loadPublicMedia(env: NodeJS.ProcessEnv = process.env) {
  const manifestFile = env.PUBLIC_MEDIA_MANIFEST || env.QINIU_PUBLIC_MANIFEST;
  if (!manifestFile) {
    if (env.PUBLIC_MEDIA_LOCAL_ROOT)
      throw new Error("Local public media requires a manifest");
    return undefined;
  }
  const manifest = parsePublicManifest(
    JSON.parse(readFileSync(manifestFile, "utf8")),
  );
  if (env.PUBLIC_MEDIA_LOCAL_ROOT)
    return createLocalPublicMedia(manifest, env.PUBLIC_MEDIA_LOCAL_ROOT);
  const { client, bucket } = createPublicMediaClient(env);
  const firstEntry = manifest.values().next().value as PublicMedia | undefined;
  return {
    manifest,
    read: (key: string, range: string | undefined, signal: AbortSignal) =>
      client.send(
        new GetObjectCommand({
          Bucket: bucket,
          Key: key,
          ...(range ? { Range: range } : {}),
        }),
        { abortSignal: signal },
      ),
    probe: async () => {
      if (!firstEntry) return;
      const object = await client.send(
        new GetObjectCommand({
          Bucket: bucket,
          Key: firstEntry.key,
          Range: "bytes=0-0",
        }),
        { abortSignal: AbortSignal.timeout(2_000) },
      );
      try {
        if (
          !object.Body ||
          object.ContentLength !== 1 ||
          object.ContentRange !== `bytes 0-0/${firstEntry.bytes}`
        )
          throw new Error(
            "Public media probe response differs from the manifest",
          );
      } finally {
        if (
          object.Body &&
          "destroy" in object.Body &&
          typeof object.Body.destroy === "function"
        )
          object.Body.destroy();
      }
    },
    close: () => client.destroy(),
  };
}
