"use client";

import { useEffect, useRef, useState } from "react";
import { useTheme } from "next-themes";
import { AlertCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth-context";
import {
  checkNativeFashion,
  finishNativeFashion,
  generateNativeFashion,
  hasNativeFashion,
  pendingNativeFashion,
  recoverNativeFashion,
} from "@/lib/fashion-native";
import { FashionResultCard } from "./fashion-result-card";
import {
  cancelGenerationApproval,
  confirmGenerationApproval,
  fetchImageModels,
} from "@/lib/server-api";
import {
  cancelFashion,
  clearFashionApproval,
  finishFashion,
  generateFashion,
  normalizeFashionResult,
  pendingFashion,
  resumeFashion,
  type FashionApproval,
  type FashionInput,
  type FashionResult,
  type FashionProgress,
} from "@/lib/fashion-generation";
import { fashionModels, type FashionModel } from "@/lib/fashion-models";
import { FashionControls } from "./fashion-controls";

type ExternalApproval = { origin: string; model: string };
type FashionRuntime = {
  setTheme(theme: string): void;
  setStatus(message: string): void;
  restore(result: FashionResult): Promise<void>;
  markSaved(jobId: string, assetId: string): Promise<void>;
  dispose(): void;
};
type FashionModule = {
  mountFashion(
    container: HTMLElement,
    host: {
      userId: string;
      theme: string;
      models: FashionModel[];
      refreshModels(): Promise<FashionModel[]>;
      generate(input: FashionInput): Promise<FashionResult>;
      completed(result: FashionResult): void;
      prepareOutput(payload: unknown): FashionResult;
      confirmExternal(approval: ExternalApproval): Promise<string>;
      nativeAvailable: boolean;
      checkNative(): Promise<{ ok: boolean; model?: string; error?: string }>;
    },
  ): FashionRuntime;
};

export function FashionWorkspace() {
  const { session } = useAuth();
  const { resolvedTheme } = useTheme();
  const container = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const runtime = useRef<FashionRuntime | null>(null);
  const controller = useRef<AbortController | null>(null);
  const pending = useRef<{
    resolve(jobId: string): void;
    reject(cause: Error): void;
  } | null>(null);
  const inFlight = useRef(false);
  const [approval, setApproval] = useState<
    FashionApproval | ExternalApproval | null
  >(null);
  const [busy, setBusy] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [hasPending, setHasPending] = useState(false);
  const [hasNativePending, setHasNativePending] = useState(false);
  const [latest, setLatest] = useState<FashionResult | null>(null);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const [models, setModels] = useState<FashionModel[]>([]);
  const catalog = useRef<FashionModel[]>([]);
  const [progress, setProgress] = useState<FashionProgress | null>(null);
  const [reload, setReload] = useState(0);
  const token = session?.access_token;
  const userId = session?.user.id;
  const theme = useRef(resolvedTheme || "dark");
  theme.current = resolvedTheme || "dark";
  function report(next: FashionProgress) {
    setProgress(next);
    runtime.current?.setStatus(next.message);
  }
  async function refreshModels() {
    const reply = await fetchImageModels();
    const next = fashionModels(reply.models, reply.unavailableModels);
    catalog.current = next;
    setModels(next);
    return next;
  }

  function requestConfirmation(current: FashionApproval | ExternalApproval) {
    if (pending.current)
      return Promise.reject(new Error("请先处理当前费用确认。"));
    return new Promise<string>((resolve, reject) => {
      pending.current = { resolve, reject };
      setApproval(current);
    });
  }

  async function exclusive<T>(operation: () => Promise<T>): Promise<T> {
    if (inFlight.current) throw new Error("当前试穿仍在处理，请稍候。");
    inFlight.current = true;
    try {
      if (!navigator.locks)
        throw new Error(
          "浏览器不支持安全的任务锁，请使用最新版 Chrome 或桌面客户端。",
        );
      return await navigator.locks.request(
        "loomic-fashion:" + userId,
        { ifAvailable: true },
        (lock) => {
          if (!lock)
            throw new Error(
              "另一个标签页正在处理试穿，请在那里完成或关闭该标签页后恢复。",
            );
          return operation();
        },
      );
    } finally {
      inFlight.current = false;
      if (userId) {
        setHasPending(Boolean(pendingFashion(userId)));
        setHasNativePending(pendingNativeFashion(userId));
      }
    }
  }

  useEffect(() => {
    runtime.current?.setTheme(resolvedTheme || "dark");
  }, [resolvedTheme]);
  useEffect(() => {
    if (approval && dialog.current && !dialog.current.open)
      dialog.current.showModal();
    if (!approval && dialog.current?.open) dialog.current.close();
  }, [approval]);
  useEffect(() => {
    if (!token || !userId || !container.current) return;
    const abort = new AbortController();
    controller.current = abort;
    setReady(false);
    setError("");
    setApproval(null);
    setLatest(null);
    const moduleUrl = "/creative/fashion.mjs";
    const modelRequest = refreshModels().catch(() => {
      if (!abort.signal.aborted)
        setError(
          "平台模型加载失败，图集和个人后端仍可使用。刷新后可重试平台模型。",
        );
      return [] as FashionModel[];
    });
    void Promise.all([
      import(/* webpackIgnore: true */ moduleUrl) as Promise<FashionModule>,
      modelRequest,
    ])
      .then(([module, available]) => {
        if (abort.signal.aborted || !container.current) return;
        runtime.current = module.mountFashion(container.current, {
          userId,
          theme: theme.current,
          models: available,
          refreshModels,
          generate: (input) =>
            exclusive(() => {
              if (input.client_config || input.model === "comfyui")
                return generateNativeFashion(input, userId);
              const selected = catalog.current.find(
                (model) => model.id === input.model,
              );
              if (!selected?.available)
                throw new Error(
                  selected?.reason || "所选模型当前不可用，请刷新模型目录。",
                );
              return generateFashion(
                input,
                userId,
                token,
                requestConfirmation,
                abort.signal,
                report,
              );
            }),
          completed: (result) => {
            if (result.jobId.startsWith("native:"))
              finishNativeFashion(userId, result.jobId);
            else finishFashion(userId, result.jobId);
            setHasPending(Boolean(pendingFashion(userId)));
            setHasNativePending(pendingNativeFashion(userId));
            setLatest(result);
          },
          prepareOutput: normalizeFashionResult,
          confirmExternal: requestConfirmation,
          nativeAvailable: hasNativeFashion(),
          checkNative: checkNativeFashion,
        });
        setHasPending(Boolean(pendingFashion(userId)));
        setHasNativePending(pendingNativeFashion(userId));
        setReady(true);
      })
      .catch((cause) => {
        if (!abort.signal.aborted)
          setError(
            cause instanceof Error ? cause.message : "试穿工作区加载失败。",
          );
      });
    return () => {
      abort.abort();
      pending.current?.reject(new Error("已离开试穿工作区，任务可恢复。"));
      pending.current = null;
      runtime.current?.dispose();
      runtime.current = null;
    };
  }, [token, userId, reload]);

  async function recover() {
    if (!userId || !token || !controller.current || recovering) return;
    setRecovering(true);
    setError("");
    try {
      await exclusive(async () => {
        const result = await resumeFashion(
          userId,
          token,
          requestConfirmation,
          controller.current!.signal,
          report,
        );
        await runtime.current?.restore(result);
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "恢复失败，请重试。");
    } finally {
      setRecovering(false);
    }
  }

  async function recoverNative(review = false) {
    if (!userId || recovering) return;
    setRecovering(true);
    setError("");
    try {
      await exclusive(async () => {
        const output = await recoverNativeFashion(userId, review);
        if (output) await runtime.current?.restore(output);
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "本机试穿恢复失败。");
    } finally {
      setRecovering(false);
    }
  }
  const resumeNative = () => recoverNative();
  const reviewNative = () => recoverNative(true);

  async function saveHistoryAsset(jobId: string, assetId: string) {
    if (!runtime.current)
      throw new Error("工作区已关闭，请重新打开生成记录后保存。");
    await runtime.current.markSaved(jobId, assetId);
  }

  async function approve() {
    if (!approval || !token || busy) return;
    setBusy(true);
    setError("");
    try {
      let jobId = "";
      if ("approvalId" in approval) {
        const reply = await confirmGenerationApproval(
          token,
          approval.approvalId,
        );
        if (!reply.data.jobId)
          throw new Error("未返回试穿任务，请重试确认以恢复原任务。");
        jobId = reply.data.jobId;
      }
      pending.current?.resolve(jobId);
      pending.current = null;
      setApproval(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "费用确认失败。");
    } finally {
      setBusy(false);
    }
  }
  async function reject() {
    if (!approval || !token || busy) return;
    setBusy(true);
    try {
      if ("approvalId" in approval)
        await cancelGenerationApproval(token, approval.approvalId);
      if ("approvalId" in approval && userId) {
        clearFashionApproval(userId, approval.approvalId);
        setHasPending(false);
        report({
          stage: "canceled",
          message: "本次报价已拒绝，没有启动生成或扣费。",
          model: approval.model,
        });
      }
      pending.current?.reject(new Error("已取消本次试穿。"));
      pending.current = null;
      setApproval(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "取消失败，请重试。");
    } finally {
      setBusy(false);
    }
  }
  async function cancelCurrent() {
    if (!token || !userId || busy) return;
    setBusy(true);
    try {
      await cancelFashion(userId, token);
      setHasPending(false);
      report({
        stage: "canceled",
        message: "服务端已确认任务终止，可重新选择模型。",
      });
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "取消失败，请恢复核对。",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="min-w-0 bg-background"
      aria-label="女装图集与试穿工作区"
    >
      {!ready && !error && (
        <p
          role="status"
          className="flex items-center gap-2 px-4 py-12 text-sm text-muted-foreground sm:px-8"
        >
          <RefreshCw className="size-4" aria-hidden="true" />
          正在加载女装工作区…
        </p>
      )}
      {error && (
        <div
          role="alert"
          className="mx-4 my-4 flex flex-wrap items-center gap-2 rounded-xl border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive sm:mx-8"
        >
          <AlertCircle className="size-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1">{error}</span>
          {!ready && (
            <Button
              onClick={() => setReload((value) => value + 1)}
              variant="outline"
            >
              重试加载工作区
            </Button>
          )}
        </div>
      )}
      {progress && (
        <div
          aria-label="试穿任务状态"
          className="flex flex-wrap items-center gap-3 border-b bg-muted/40 px-4 py-3 text-xs sm:px-8"
        >
          <span role="status">{progress.message}</span>
          {progress.jobId && ["running", "queued"].includes(progress.stage) && (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={cancelCurrent}
            >
              取消当前任务
            </Button>
          )}
          <a href="/settings/?tab=usage" className="underline">
            查看用量与费用
          </a>
        </div>
      )}
      {hasPending && (
        <div className="flex flex-wrap items-center gap-3 border-b border-border bg-muted/40 px-4 py-3 text-xs sm:px-8">
          <span className="text-muted-foreground">
            有待确认或待取回的试穿任务。
          </span>
          <Button
            type="button"
            variant="outline"
            disabled={recovering}
            onClick={recover}
          >
            {recovering ? "正在恢复原任务…" : "恢复试穿结果"}
          </Button>
          <a href="/agent-history/" className="underline underline-offset-4">
            查看活动
          </a>
        </div>
      )}
      {hasNativePending && (
        <div className="flex flex-wrap items-center gap-3 border-b border-border bg-muted/40 px-4 py-3 text-xs sm:px-8">
          <span className="text-muted-foreground">
            有待取回或待核验的本机试穿任务。
          </span>
          <Button
            type="button"
            variant="outline"
            disabled={recovering}
            onClick={resumeNative}
          >
            恢复本机结果
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={recovering}
            onClick={reviewNative}
          >
            核验中断任务
          </Button>
        </div>
      )}
      {latest && token && (
        <FashionResultCard
          key={latest.jobId}
          output={latest}
          token={token}
          onSaved={saveHistoryAsset}
        />
      )}
      <div ref={container} className="min-h-full" />
      {ready && (
        <FashionControls container={container.current} models={models} />
      )}
      <dialog
        ref={dialog}
        onCancel={(event) => {
          event.preventDefault();
          void reject();
        }}
        aria-labelledby="fashion-approval-title"
        className="m-auto w-[calc(100%-2rem)] max-w-md rounded-2xl border border-border bg-card p-6 text-foreground shadow-xl backdrop:bg-black/60"
      >
        {approval && (
          <>
            <h2 id="fashion-approval-title" className="text-lg font-semibold">
              确认本次试穿费用
            </h2>
            <p className="mt-3 text-sm">
              模型：
              {models.find((model) => model.id === approval.model)
                ?.displayName ?? approval.model}
            </p>
            {"approvalId" in approval && (
              <p className="mt-2 text-xs text-muted-foreground">
                竖屏 2:3 · 1张结果 ·
                人物照片与服装参考。修改模型或照片需重新报价。
              </p>
            )}
            {"approvalId" in approval ? (
              <p className="mt-2 text-sm">
                本次预占 {approval.estimatedCredits}{" "}
                积分，确认后提交照片和服装给模型。按张计费以此报价结算，Token 计费按实际用量结算。有效期至{" "}
                {new Date(approval.expiresAt).toLocaleTimeString()}。
              </p>
            ) : (
              <p className="mt-2 break-all text-sm">
                照片和服装将发送到你配置的后端 {approval.origin}
                。第三方模型可能收费，费用由该服务结算。
              </p>
            )}
            <p className="mt-2 text-xs text-muted-foreground">
              每次生成都需要确认，自动批准设置不影响此操作。
            </p>
            <div className="mt-5 flex justify-end gap-3">
              <Button
                autoFocus
                type="button"
                variant="outline"
                onClick={reject}
                disabled={busy}
              >
                取消
              </Button>
              <Button type="button" onClick={approve} disabled={busy}>
                {busy ? "正在处理…" : "确认生成"}
              </Button>
            </div>
            {error && (
              <p role="alert" className="mt-3 text-sm text-destructive">
                {error}
              </p>
            )}
          </>
        )}
      </dialog>
    </section>
  );
}
