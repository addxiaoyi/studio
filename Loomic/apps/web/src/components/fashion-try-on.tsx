"use client";

import { useRef, useState } from "react";
import { useCreateProject } from "@/hooks/use-create-project";
import { useAuth } from "@/lib/auth-context";
import { uploadFile } from "@/lib/server-api";
import { fashionRequestKey } from "@/lib/fashion-request-key";

const MAX_PHOTO_BYTES = 25 * 1024 * 1024;
const PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

type Outfit = { id: string; image: string };

export function FashionTryOn({ outfit }: { outfit: Outfit }) {
  const { session } = useAuth();
  const { create, creating } = useCreateProject();
  const [photo, setPhoto] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const [error, setError] = useState("");

  async function submitTryOn() {
    if (submitting.current) return;
    const token = session?.access_token;
    if (!token) return setError("请先登录后再试穿。");
    if (!photo || !PHOTO_TYPES.has(photo.type) || photo.size === 0 || photo.size > MAX_PHOTO_BYTES) {
      return setError("请选择不超过 25 MB 的 JPG、PNG 或 WebP 照片。");
    }

    submitting.current = true;
    setBusy(true);
    setError("");
    try {
      const { storageKey, requestKey } = await fashionRequestKey(session.user.id, outfit, photo);
      const response = await fetch(`/fashion-gallery/${outfit.image}`);
      if (!response.ok) throw new Error("服装参考图加载失败，请重试。");
      const reference = await response.blob();
      if (!reference.size || !reference.type.startsWith("image/")) {
        throw new Error("服装参考图无效，请选择其他款式。");
      }
      const referenceFile = new File([reference], `outfit-${outfit.id}.webp`, { type: reference.type });
      const personAsset = await uploadFile(token, photo, undefined, "try-on");
      const outfitAsset = await uploadFile(token, referenceFile);
      const opened = await create({
        idempotencyKey: requestKey,
        prompt: "请使用第一张图片中的人物和第二张图片中的服装生成虚拟试穿图，保持人物身份与服装细节。",
        imageGenerationPreference: { mode: "auto", models: [], requirePaidConfirmation: true },
        attachments: [
          { assetId: personAsset.asset.id, url: personAsset.url, mimeType: photo.type, source: "upload", name: photo.name },
          { assetId: outfitAsset.asset.id, url: outfitAsset.url, mimeType: reference.type, source: "upload", name: referenceFile.name },
        ],
      });
      if (!opened) setError("无法创建试穿画布，请检查登录状态后重试。");
      else {
        try {
          sessionStorage.removeItem(storageKey);
        } catch {
          setError("画布已创建，但无法清除重试信息；请检查浏览器会话存储。");
        }
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "试穿准备失败，请重试。");
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  return (
    <section className="mt-4 border-t border-border pt-4" aria-label="虚拟试穿">
      <h2 className="text-sm font-semibold">虚拟试穿</h2>
      <label className="mt-3 block text-sm" htmlFor="fashion-photo">选择人物照片</label>
      <input id="fashion-photo" type="file" accept="image/jpeg,image/png,image/webp" className="mt-2 block w-full text-sm" onChange={(event) => { setPhoto(event.target.files?.[0] ?? null); setError(""); }} />
      <p className="mt-2 text-xs text-muted-foreground">照片和服装参考图将上传到素材库，并发送给所选图像模型。付费生成前需要逐次确认费用。</p>
      {error && <p role="alert" className="mt-2 text-sm text-destructive">{error}</p>}
      <button type="button" onClick={submitTryOn} disabled={busy || creating} className="mt-3 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50">
        {busy || creating ? "正在准备试穿…" : "在画布中试穿"}
      </button>
    </section>
  );
}
