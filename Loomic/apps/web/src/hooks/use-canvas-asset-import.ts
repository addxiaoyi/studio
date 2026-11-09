"use client";
import { useCallback, useEffect, useState } from "react";
import {
  importCanvasAsset,
  type CanvasImportApi,
} from "@/lib/canvas-asset-import";

type ImportProps = {
  api: CanvasImportApi | null;
  ready: boolean;
  canvasId: string | null;
  assetId: string | null;
  token: string | undefined;
};
export function useCanvasAssetImport({
  api,
  ready,
  canvasId,
  assetId,
  token,
}: ImportProps) {
  const [revision, setRevision] = useState(0);
  const [status, setStatus] = useState<
    "idle" | "loading" | "imported" | "error"
  >("idle");
  const [error, setError] = useState("");
  useEffect(() => {
    if (!assetId) {
      setStatus("idle");
      setError("");
      return;
    }
    if (!ready || !api || !token || !canvasId) return;
    const abort = new AbortController();
    setStatus("loading");
    setError("");
    void importCanvasAsset(api, token, assetId, abort.signal)
      .then(() => {
        if (!abort.signal.aborted) setStatus("imported");
      })
      .catch((cause) => {
        if (abort.signal.aborted) return;
        setStatus("error");
        setError(
          cause instanceof Error ? cause.message : "素材导入失败，请重试。",
        );
      });
    return () => abort.abort();
  }, [api, ready, canvasId, assetId, token, revision]);
  const retry = useCallback(() => setRevision((value) => value + 1), []);
  return { status, error, retry };
}
