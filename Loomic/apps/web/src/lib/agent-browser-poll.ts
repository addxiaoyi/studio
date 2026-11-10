import { AgentBrowserAccessError, AgentBrowserRequestError } from "./agent-browser-api";

const REQUEST_TIMEOUT = 15_000;
const MAX_RETRY = 60_000;

export function pollBrowserSessions(options: {
  read(signal: AbortSignal): Promise<void>;
  report(error: Error | null, retryAt: number | null): void;
  interval(): number;
}) {
  let stopped = false, denied = false, failures = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let request: AbortController | undefined;
  const available = () => !document.hidden && navigator.onLine !== false;
  async function poll() {
    if (stopped || denied || request || !available()) return;
    const abort = new AbortController();
    request = abort;
    let expired = false;
    const deadline = setTimeout(() => { expired = true; abort.abort(); }, REQUEST_TIMEOUT);
    let delay = options.interval();
    try {
      await options.read(abort.signal);
      if (stopped || abort.signal.aborted) return;
      failures = 0;
      delay = options.interval();
      options.report(null, null);
    } catch (cause) {
      if (stopped || (abort.signal.aborted && !expired)) return;
      denied = cause instanceof AgentBrowserAccessError;
      failures++;
      const retryAfter = cause instanceof AgentBrowserRequestError ? cause.retryAfterMs : 0;
      delay = Math.min(MAX_RETRY, Math.max(retryAfter, 2000 * 2 ** Math.min(failures - 1, 5) * (1 + Math.random() * 0.2)));
      options.report(expired ? new Error("连接浏览器会话超时，请检查网络或重试。") : cause instanceof Error ? cause : new Error("无法读取浏览器会话。"), denied ? null : Date.now() + delay);
    } finally {
      clearTimeout(deadline);
      request = undefined;
      if (!stopped && !denied && available()) timer = setTimeout(poll, delay);
    }
  }
  function visibility() {
    clearTimeout(timer);
    if (!available()) {
      request?.abort();
      if (navigator.onLine === false) options.report(new Error("网络已断开，恢复连接后将自动重试。"), null);
      return;
    }
    void poll();
  }
  window.addEventListener("online", visibility);
  window.addEventListener("offline", visibility);
  document.addEventListener("visibilitychange", visibility);
  visibility();
  return () => {
    stopped = true; request?.abort(); clearTimeout(timer);
    window.removeEventListener("online", visibility);
    window.removeEventListener("offline", visibility);
    document.removeEventListener("visibilitychange", visibility);
  };
}
