"use client";

import { Button } from "@/components/ui/button";
import {
  type SavedWebsiteSession,
  forgetWebsiteSession,
  listWebsiteSessions,
} from "@/lib/website-journey-api";
import { useCallback, useEffect, useRef, useState } from "react";

export function WebsiteSessionManager({ token }: { token: string }) {
  return <WebsiteSessions key={token} token={token} />;
}

function WebsiteSessions({ token }: { token: string }) {
  const [open, setOpen] = useState(false);
  const [sessions, setSessions] = useState<SavedWebsiteSession[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const reads = useRef(0);
  const lifetime = useRef(0);
  const revoking = useRef(false);

  useEffect(
    () => () => {
      lifetime.current += 1;
      reads.current += 1;
    },
    [],
  );

  const refresh = useCallback(async () => {
    if (revoking.current) return;
    const request = ++reads.current;
    setBusy(true);
    setError("");
    try {
      const saved = await listWebsiteSessions(token);
      if (request === reads.current) setSessions(saved);
    } catch (cause) {
      if (request === reads.current) {
        setError(cause instanceof Error ? cause.message : "登录会话读取失败。");
      }
    } finally {
      if (request === reads.current) setBusy(false);
    }
  }, [token]);

  useEffect(() => {
    if (open) void refresh();
    return () => {
      reads.current += 1;
    };
  }, [open, refresh]);

  async function revoke(id: string) {
    if (busy || revoking.current) return;
    const scope = lifetime.current;
    revoking.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await forgetWebsiteSession(token, id);
      if (scope !== lifetime.current) return;
      setSessions((saved) => saved.filter((session) => session.id !== id));
      setNotice("登录会话已撤销，使用此会话的任务已停止。");
      window.dispatchEvent(new Event("loomic:website-sessions-changed"));
    } catch (cause) {
      if (scope === lifetime.current) {
        setError(cause instanceof Error ? cause.message : "撤销失败，请重试。");
      }
    } finally {
      revoking.current = false;
      if (scope === lifetime.current) setBusy(false);
    }
  }

  function toggleSessions() {
    setOpen((visible) => !visible);
  }

  return (
    <section
      className="mb-4 rounded-lg border p-3"
      aria-label="网站登录会话管理"
    >
      <button
        type="button"
        className="w-full text-left text-sm font-medium"
        aria-expanded={open}
        onClick={toggleSessions}
      >
        网站登录会话{open ? " · 收起" : " · 管理"}
      </button>
      {open && (
        <div className="mt-3 space-y-3">
          <p className="text-xs text-muted-foreground">
            撤销后立即停止依赖此会话的任务，并清除服务端保存的登录态。网站自身的其他设备登录不受影响。
          </p>
          {busy && <output className="block text-xs">正在更新…</output>}
          {sessions.map((session) => (
            <div
              key={session.id}
              className="flex items-center gap-3 border-t pt-3"
            >
              <div className="min-w-0 flex-1 text-xs">
                <p className="break-all font-medium">{session.origin}</p>
                <p className="text-muted-foreground">
                  到期：{new Date(session.expiresAt).toLocaleString()} ·{" "}
                  {session.activeTasks ?? 0} 个任务使用中
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => void revoke(session.id)}
              >
                立即撤销
              </Button>
            </div>
          ))}
          {!busy && !sessions.length && (
            <p className="text-xs text-muted-foreground">
              没有已保存的网站会话。
            </p>
          )}
          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
          {notice && <output className="block text-xs">{notice}</output>}
          <Button size="sm" variant="ghost" disabled={busy} onClick={refresh}>
            刷新会话
          </Button>
        </div>
      )}
    </section>
  );
}
