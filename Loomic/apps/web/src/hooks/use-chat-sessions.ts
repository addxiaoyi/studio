"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { ChatSessionSummary, ContentBlock } from "@helstera/shared";
import type { ChatMessage as ChatMessageData } from "@helstera/shared";
import {
  createSession,
  deleteSession as deleteSessionApi,
  fetchMessages,
  fetchSessions,
  updateSessionTitle,
} from "../lib/server-api";
function hideRawThinkingTags(text: string): string {
  return text.replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, "").replace(/<\/?think>/gi, "");
}

// ── Types ────────────────────────────────────────────────────

export type Message = {
  id: string;
  role: "user" | "assistant";
  contentBlocks: ContentBlock[];
};

// ── LRU message cache ────────────────────────────────────────
// Limits memory usage by evicting the least-recently-accessed
// session's messages when the cache exceeds MAX_CACHED_SESSIONS.

const MAX_CACHED_SESSIONS = 10;

type LRUMessageCache = {
  get(sessionId: string): Message[] | undefined;
  set(sessionId: string, messages: Message[]): void;
  delete(sessionId: string): void;
};

function createLRUMessageCache(): LRUMessageCache {
  // Map preserves insertion order; we move accessed keys to the end.
  const cache = new Map<string, Message[]>();

  return {
    get(sessionId) {
      const value = cache.get(sessionId);
      if (value !== undefined) {
        // Move to end (most recently used)
        cache.delete(sessionId);
        cache.set(sessionId, value);
      }
      return value;
    },

    set(sessionId, messages) {
      // Delete first so re-insert moves to end
      cache.delete(sessionId);
      cache.set(sessionId, messages);

      // Evict oldest if over capacity
      if (cache.size > MAX_CACHED_SESSIONS) {
        const oldest = cache.keys().next().value;
        if (oldest !== undefined) {
          cache.delete(oldest);
        }
      }
    },

    delete(sessionId) {
      cache.delete(sessionId);
    },
  };
}

// ── Helpers ──────────────────────────────────────────────────

export function mapServerMessages(
  serverMessages: ChatMessageData[],
): Message[] {
  return serverMessages.map((m) => {
    let blocks: ContentBlock[];
    if (m.contentBlocks && m.contentBlocks.length > 0) {
      blocks = m.contentBlocks.map((block) =>
        block.type === "text" ? { ...block, text: hideRawThinkingTags(block.text) } : block,
      );
    } else {
      blocks = [];
      if (m.content) {
        blocks.push({ type: "text", text: hideRawThinkingTags(m.content) });
      }
      if (m.toolActivities) {
        for (const ta of m.toolActivities) {
          blocks.push({
            type: "tool",
            toolCallId: ta.toolCallId,
            toolName: ta.toolName,
            status: ta.status as "running" | "completed",
            ...(ta.input ? { input: ta.input } : {}),
            ...(ta.output ? { output: ta.output } : {}),
            ...(ta.outputSummary ? { outputSummary: ta.outputSummary } : {}),
            ...(ta.artifacts ? { artifacts: ta.artifacts } : {}),
          });
        }
      }
    }
    return { id: m.id, role: m.role, contentBlocks: blocks };
  });
}

// ── Hook ─────────────────────────────────────────────────────

type UseChatSessionsOptions = {
  canvasId: string;
  accessToken: string;
  initialSessionId?: string | undefined;
  onSessionChange?: ((sessionId: string) => void) | undefined;
};

export function useChatSessions({
  canvasId,
  accessToken,
  initialSessionId,
  onSessionChange,
}: UseChatSessionsOptions) {
  const [sessions, setSessions] = useState<ChatSessionSummary[]>([]);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [messagesError, setMessagesError] = useState<string | null>(null);
  const selectionRequestRef = useRef(0);
  const [streaming, setStreaming] = useState(false);

  // Refs to avoid stale closures in callbacks
  const accessTokenRef = useRef(accessToken);
  accessTokenRef.current = accessToken;
  const activeSessionIdRef = useRef(activeSessionId);
  activeSessionIdRef.current = activeSessionId;
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const onSessionChangeRef = useRef(onSessionChange);
  onSessionChangeRef.current = onSessionChange;

  // LRU message cache (replaces unbounded Record)
  const msgCacheRef = useRef<LRUMessageCache>(createLRUMessageCache());

  // ── Update messages for a specific session ──
  // Always writes to cache; only syncs to React state if the session is visible.
  const updateSessionMessages = useCallback(
    (targetSessionId: string, updater: (prev: Message[]) => Message[]) => {
      const prev = msgCacheRef.current.get(targetSessionId) ?? [];
      const next = updater(prev);
      msgCacheRef.current.set(targetSessionId, next);
      if (activeSessionIdRef.current === targetSessionId) {
        setMessages(next);
      }
    },
    [],
  );

  const reloadSessions = useCallback(async () => {
    const token = accessTokenRef.current;
    if (!token) return;
    const requestId = ++selectionRequestRef.current;
    setSessionsLoading(true);
    setSessionsError(null);
    setMessagesError(null);
    try {
      const res = await fetchSessions(token, canvasId);
      if (requestId !== selectionRequestRef.current) return;
      setSessions(res.sessions);
      if (res.sessions.length === 0) {
        setActiveSessionId(null);
        setMessages([]);
        return;
      }
      const target = res.sessions.find((session) => session.id === activeSessionIdRef.current) ?? res.sessions[0]!;
      setActiveSessionId(target.id);
      onSessionChangeRef.current?.(target.id);
      setMessagesLoading(true);
      const messageResponse = await fetchMessages(token, target.id);
      if (requestId !== selectionRequestRef.current || activeSessionIdRef.current !== target.id) return;
      const mapped = mapServerMessages(messageResponse.messages);
      msgCacheRef.current.set(target.id, mapped);
      setMessages(mapped);
    } catch (error) {
      const message = error instanceof Error ? error.message : "无法恢复会话。";
      if (sessionsRef.current.length === 0) setSessionsError(message);
      else setMessagesError(message);
    } finally {
      if (requestId === selectionRequestRef.current) {
        setSessionsLoading(false);
        setMessagesLoading(false);
      }
    }
  }, [canvasId]);

  // ── Load sessions on mount ──
  useEffect(() => {
    let cancelled = false;

    async function init() {
      const token = accessTokenRef.current;
      let sessionListLoaded = false;
      setSessionsLoading(true);
      setSessionsError(null);
      setSessionsError(null);
      try {
        const res = await fetchSessions(token, canvasId);
        if (cancelled) return;
        sessionListLoaded = true;

        if (res.sessions.length > 0) {
          setSessions(res.sessions);
          const target = initialSessionId
            ? (res.sessions.find((s: ChatSessionSummary) => s.id === initialSessionId) ??
              res.sessions[0]!)
            : res.sessions[0]!;
          setActiveSessionId(target.id);
          onSessionChangeRef.current?.(target.id);
          const msgRes = await fetchMessages(token, target.id);
          if (cancelled) return;
          const mapped = mapServerMessages(msgRes.messages);
          msgCacheRef.current.set(target.id, mapped);
          setMessages(mapped);
        } else {
          const created = await createSession(token, canvasId);
          if (cancelled) return;
          setSessions([created.session]);
          setActiveSessionId(created.session.id);
          onSessionChangeRef.current?.(created.session.id);
          setMessages([]);
        }
      } catch (error) {
        if (!cancelled) {
          const message = error instanceof Error ? error.message : "无法恢复聊天记录。";
          if (sessionListLoaded) setMessagesError(message);
          else setSessionsError(message);
        }
        if (!cancelled) setSessionsError(error instanceof Error ? error.message : "无法加载会话列表。");
      } finally {
        if (!cancelled) setSessionsLoading(false);
      }
    }

    void init();
    return () => {
      cancelled = true;
    };
    // Intentionally depends only on canvasId — accessTokenRef, onSessionChangeRef,
    // initialSessionId, and msgCacheRef are stable refs that never trigger re-runs.
    // This effect is a one-time init per canvas, not a token-refresh handler.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvasId]);

  // ── Session switch ──
  const handleSelectSession = useCallback(
    async (sessionId: string) => {
      if (sessionId === activeSessionIdRef.current) return;
      const requestId = ++selectionRequestRef.current;
      if (streaming) setStreaming(false);
      setActiveSessionId(sessionId);
      onSessionChangeRef.current?.(sessionId);
      setMessagesError(null);

      const cached = msgCacheRef.current.get(sessionId);
      if (cached && cached.length > 0) {
        setMessages(cached);
        setMessagesLoading(false);
      } else {
        setMessages([]);
        setMessagesLoading(true);
        try {
          const msgRes = await fetchMessages(accessTokenRef.current, sessionId);
          if (requestId !== selectionRequestRef.current || activeSessionIdRef.current !== sessionId) return;
          const mapped = mapServerMessages(msgRes.messages);
          msgCacheRef.current.set(sessionId, mapped);
          setMessages(mapped);
        } catch (err) {
          if (requestId === selectionRequestRef.current && activeSessionIdRef.current === sessionId) {
            setMessagesError(err instanceof Error ? err.message : "无法加载此会话消息。");
          }
        } finally {
          if (requestId === selectionRequestRef.current) setMessagesLoading(false);
        }
      }
    },
    [streaming],
  );

  // ── New chat ──
  const handleNewChat = useCallback(async () => {
    selectionRequestRef.current += 1;
    if (streaming) setStreaming(false);
    try {
      const res = await createSession(accessTokenRef.current, canvasId);
      setSessions((prev) => [res.session, ...prev]);
      setActiveSessionId(res.session.id);
      onSessionChangeRef.current?.(res.session.id);
      setMessages([]);
      setMessagesError(null);
      setMessagesLoading(false);
    } catch {
      // Silently fail
    }
  }, [canvasId, streaming]);

  // ── Delete session ──
  const handleDeleteSession = useCallback(
    async (sessionId: string) => {
      if (streaming || !sessionId) return;
      const token = accessTokenRef.current;
      const remaining = sessionsRef.current.filter((s) => s.id !== sessionId);

      if (remaining.length === 0) {
        try {
          selectionRequestRef.current += 1;
          const res = await createSession(token, canvasId);
          setSessions([res.session]);
          setActiveSessionId(res.session.id);
          onSessionChangeRef.current?.(res.session.id);
          setMessages([]);
        } catch {
          return;
        }
      } else {
        setSessions(remaining);
        if (sessionId === activeSessionIdRef.current) {
          const requestId = ++selectionRequestRef.current;
          const next = remaining[0]!;
          setActiveSessionId(next.id);
          onSessionChangeRef.current?.(next.id);
          setMessagesLoading(true);
          fetchMessages(token, next.id)
            .then((msgRes) => {
              if (requestId !== selectionRequestRef.current || activeSessionIdRef.current !== next.id) return;
              const mapped = mapServerMessages(msgRes.messages);
              msgCacheRef.current.set(next.id, mapped);
              setMessages(mapped);
            })
            .catch((error) => {
              if (requestId === selectionRequestRef.current) setMessagesError(error instanceof Error ? error.message : "无法加载会话消息。");
            })
            .finally(() => { if (requestId === selectionRequestRef.current) setMessagesLoading(false); });
        }
      }

      // Delete in background
      deleteSessionApi(token, sessionId).catch(() => {
        fetchSessions(token, canvasId)
          .then((res) => setSessions(res.sessions))
          .catch(() => {});
      });

      // Clean up cached messages for deleted session
      msgCacheRef.current.delete(sessionId);
    },
    [canvasId, streaming],
  );

  // ── Auto-title first message ──
  const autoTitleSession = useCallback((text: string) => {
    const currentSessionId = activeSessionIdRef.current;
    if (!currentSessionId) return;
    const isFirstMessage = messagesRef.current.length === 0;
    if (!isFirstMessage) return;

    const title = text.length > 50 ? `${text.slice(0, 47)}...` : text;
    void updateSessionTitle(accessTokenRef.current, currentSessionId, title);
    setSessions((prev) =>
      prev.map((s) => (s.id === currentSessionId ? { ...s, title } : s)),
    );
  }, []);

  // ── Reload messages (for reconnection) ──
  const reloadMessages = useCallback(async (sessionId: string) => {
    if (!sessionId) {
      console.warn("[chat] reloadMessages called with empty sessionId, skipping");
      return;
    }
    setMessagesError(null);
    setMessagesLoading(true);
    try {
      const msgRes = await fetchMessages(accessTokenRef.current, sessionId);
      const mapped = mapServerMessages(msgRes.messages);
      msgCacheRef.current.set(sessionId, mapped);
      if (activeSessionIdRef.current === sessionId) {
        setMessages(mapped);
      }
    } catch (err) {
      console.warn("[chat] Failed to reload messages on reconnect:", err);
      if (activeSessionIdRef.current === sessionId) {
        setMessagesError(err instanceof Error ? err.message : "重新连接后无法恢复消息。");
      }
    } finally {
      if (activeSessionIdRef.current === sessionId) setMessagesLoading(false);
    }
  }, []);

  return {
    sessions,
    sessionsError,
    activeSessionId,
    activeSessionIdRef,
    messages,
    messagesRef,
    setMessages,
    sessionsLoading,
    messagesLoading,
    messagesError,
    streaming,
    setStreaming,
    updateSessionMessages,
    handleSelectSession,
    handleNewChat,
    handleDeleteSession,
    autoTitleSession,
    reloadMessages,
    reloadSessions,
    accessTokenRef,
  };
}
