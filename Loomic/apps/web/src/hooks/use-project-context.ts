"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { projectContextSchema, type ProjectContext, type ProjectView } from "@helstera/shared";
import { contextQuery, fetchProjectContext, updateProjectContext } from "@/lib/project-context-api";

export function useProjectContext(input: { userId?: string | undefined; token?: string | undefined; address: string; view: ProjectView; enabled?: boolean }) {
  const { userId, token, address, view, enabled = true } = input;
  const [context, setContext] = useState<ProjectContext | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const current = useRef(context); current.current = context;
  const lifetime = useRef<AbortController | null>(null);
  const writes = useRef<Promise<unknown>>(Promise.resolve());
  const retry = useCallback(() => setAttempt(value => value + 1), []);
  const remember = useCallback((next: ProjectContext | null) => {
    current.current = next;
    setContext(next);
    if (!userId || !next) return;
    try { sessionStorage.setItem(`helstera:project-context:${userId}`, JSON.stringify(next)); }
    catch (cause) { console.warn("[project-context] Session hint could not be saved", cause); }
  }, [userId]);

  useEffect(() => {
    const abort = new AbortController(); lifetime.current = abort;
    setContext(null); current.current = null; setError("");
    if (!enabled || !userId || !token) {
      if (userId && !enabled && new URL(address).searchParams.get("draft")==="1") {
        try { sessionStorage.setItem(`helstera:project-mode:${userId}`,"draft"); }
        catch (cause) { console.warn("[project-context] Draft mode hint could not be saved", cause); }
      }
      setLoading(false); return () => abort.abort();
    }
    setLoading(true);
    let query = contextQuery(address);
    // The editor owns ?/Composition navigation; keep the verified project identity beside it.
    if (!query.projectId && !query.canvasId && new URL(address).search.startsWith("?/")) {
      try {
        if (sessionStorage.getItem(`helstera:project-mode:${userId}`)==="draft") { setLoading(false); return () => abort.abort(); }
        const cached = projectContextSchema.safeParse(JSON.parse(sessionStorage.getItem(`helstera:project-context:${userId}`) ?? "null"));
        if (cached.success) query = { projectId: cached.data.project.id, canvasId: cached.data.canvas.id };
      } catch (cause) { console.warn("[project-context] Stored navigation hint is unreadable", cause); }
    }
    void fetchProjectContext(token,query,abort.signal).then(async next => {
      if (abort.signal.aborted) return;
      if (next && (next.view !== view || next.revision===0 || query.projectId || query.canvasId || query.sessionId)) next = await updateProjectContext(token, {
        projectId: next.project.id, canvasId: next.canvas.id, sessionId: next.session?.id ?? null,
        view, compositionId: next.compositionId, expectedRevision: next.revision,
      }, abort.signal);
      if (!abort.signal.aborted) {
        remember(next);
        try { sessionStorage.setItem(`helstera:project-mode:${userId}`, next ? "project" : "draft"); }
        catch (cause) { console.warn("[project-context] Project mode hint could not be saved", cause); }
      }
    }).catch(cause => {
      if (!abort.signal.aborted) setError(cause instanceof Error ? cause.message : "工程位置读取失败，请重试。");
    }).finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => { abort.abort(); if (lifetime.current === abort) lifetime.current = null; };
  }, [address,attempt,enabled,remember,token,userId,view]);

  const saveLocation = useCallback((nextView: ProjectView, compositionId?: string | null): Promise<void> => {
    const controller = lifetime.current, projectId = current.current?.project.id;
    if (!projectId || !token || !controller) return Promise.resolve();
    const write = async () => {
      controller.signal.throwIfAborted();
      const previous = current.current;
      if (!previous || previous.project.id!==projectId) throw new Error("工程已切换，未写入旧页面的位置。");
      const next = await updateProjectContext(token, {
        projectId, canvasId: previous.canvas.id, sessionId: previous.session?.id ?? null,
        view: nextView, compositionId: compositionId === undefined ? previous.compositionId : compositionId,
        expectedRevision: previous.revision,
      }, controller.signal);
      controller.signal.throwIfAborted();remember(next);
    };
    // Each caller receives its failure; a rejected save must not poison later explicit retries.
    const pending = writes.current.then(write,write);
    writes.current = pending;
    return pending;
  }, [remember,token]);
  return { context, loading, error, retry, saveLocation };
}
