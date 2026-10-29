"use client";

import { useEffect, useRef, useState } from "react";
import { WifiOff } from "lucide-react";
import { useOptionalAuth } from "@/lib/auth-context";
import { getRealtimeStatus, hasEverConnected, subscribeRealtimeStatus } from "@/lib/realtime-status";

type BannerState = "idle" | "disconnected" | "recovered";

const COPY = {
  "zh-CN": {
    disconnected: "连接已断开，正在重新连接…",
    recovered: "连接已恢复",
    offline: "网络不可用，请检查网络连接",
    // 会话加载失败时登录状态未知：横幅不依赖 socket，必须能说话，
    // 否则"连不上工作区"在登录页上永远没有任何提示。
    sessionFailed: "无法确认登录状态，正在重新连接…",
  },
  "en-US": {
    disconnected: "Connection lost — reconnecting…",
    recovered: "Connection restored",
    offline: "You are offline — check your network",
    sessionFailed: "Unable to confirm sign-in state — reconnecting…",
  },
} as const;

const RECOVERED_VISIBLE_MS = 2000;

/**
 * Shell-level connectivity banner.
 *
 * The shell has no socket of its own; pages publish their socket state through
 * `realtime-status`. The banner stays quiet during the first connect (so a cold load
 * does not flash "disconnected") and only speaks up once a connection existed and
 * then dropped, or when the browser itself reports being offline.
 */
export function DesktopConnectionBanner({ locale = "zh-CN" }: { locale?: keyof typeof COPY }) {
  const [state, setState] = useState<BannerState>("idle");
  const [offline, setOffline] = useState(false);
  const sawConnected = useRef(hasEverConnected());
  const copy = COPY[locale];
  // Optional: the banner also renders outside the provider (tests, bare routes).
  const sessionFailed = useOptionalAuth()?.sessionError != null;

  useEffect(() => {
    const unsubscribe = subscribeRealtimeStatus((status) => {
      if (status === "connected") {
        sawConnected.current = true;
        // Only a disconnected -> connected transition is worth announcing; the very
        // first connect on a cold load must stay silent.
        setState((current) => (current === "disconnected" ? "recovered" : "idle"));
        return;
      }
      setState(() => (sawConnected.current ? "disconnected" : "idle"));
    });
    if (getRealtimeStatus() === "disconnected" && sawConnected.current) setState("disconnected");
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (state !== "recovered") return;
    const timer = setTimeout(() => setState("idle"), RECOVERED_VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [state]);

  useEffect(() => {
    if (typeof navigator === "undefined") return;
    const sync = () => setOffline(!navigator.onLine);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);

  // A failed session lookup leaves the sign-in state unknown — that is a connection
  // fault, not a signed-out user, so the banner speaks up without waiting for a socket.
  if (sessionFailed) {
    return (
      <div className="desktop-connection-banner desktop-connection-banner--error" role="alert">
        <WifiOff aria-hidden="true" />
        <span>{copy.sessionFailed}</span>
      </div>
    );
  }

  if (offline) {
    return (
      <div className="desktop-connection-banner desktop-connection-banner--error" role="alert">
        <WifiOff aria-hidden="true" />
        <span>{copy.offline}</span>
      </div>
    );
  }

  if (state === "idle") return null;

  return (
    <div
      className={`desktop-connection-banner${state === "recovered" ? " desktop-connection-banner--ok" : ""}`}
      role="status"
    >
      <WifiOff aria-hidden="true" />
      <span>{state === "recovered" ? copy.recovered : copy.disconnected}</span>
    </div>
  );
}
