import { fillPageField, isCredentialAction, websiteActionReceipt } from "./action-safety.js";
import { getReconnectDelay } from "./reconnect-policy.js";

let socket = null;
let connectionAccepted = false;
let reconnectTimer = null;
let reconnectAttempt = 0;
let userRequestedDisconnect = false;
let lastActiveTabId = null;
let lastActiveWindowId = null;
let pairingTabId = null;
let returnTabId = null;
let returnWindowId = null;
const CONNECT_TIMEOUT_MS = 15_000;
const PAIRING_PAGE_PATH = "/desktop-browser-pair.html";
let currentState = { connected: false, message: "未连接" };
let pendingRecording = null;
let recordingWaitResolve = null;
const taskTabs = new Map();
const consumedApprovalIds = new Set();
const desktopAgentTasks = new Map();

function setState(next) {
  const state = next.connected === true && !connectionAccepted
    ? { ...next, connected: false }
    : next;
  currentState = { ...currentState, ...state };
  chrome.runtime.sendMessage({ type: "assistant.state", state: currentState }).catch(() => undefined);
  if (state.connected === false && (!socket || socket.readyState === WebSocket.CLOSED)) {
    void scheduleReconnect();
  }
}

async function connect(wssUrl, code, sessionToken) {
  if (socket && socket.readyState === WebSocket.OPEN) return { ...currentState, message: "已经连接" };
  const safeUrl = safeWssUrl(wssUrl);
  connectionAccepted = false;
  if (code) {
    userRequestedDisconnect = false;
    reconnectAttempt = 0;
  }
  if (!safeUrl) return { connected: false, message: "只允许连接 Helstera 的 WSS 助手地址" };
  const separator = wssUrl.includes("?") ? "&" : "?";
  const credential = sessionToken
    ? `session_token=${encodeURIComponent(sessionToken)}`
    : `code=${encodeURIComponent(code)}`;
  socket = new WebSocket(`${safeUrl}${separator}${credential}`);
  socket.onopen = async () => {
    setState({ connected: true, message: "已连接，等待浏览任务" });
    socket.send(JSON.stringify({ type: "assistant.ready", browser: navigator.userAgent, platform: navigator.platform, clientKind: "browser-extension" }));
    await chrome.storage.local.set({ wssUrl });
  };
  socket.onmessage = (event) => {
    try { void handleServerMessage(JSON.parse(event.data)); } catch { setState({ message: "收到无法识别的服务器消息" }); }
  };
  socket.onerror = () => setState({ connected: false, message: "WSS 连接失败" });
  socket.onclose = (event) => {
    socket = null;
    if ([4001, 4004].includes(event.code)) {
      userRequestedDisconnect = true;
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
      reconnectAttempt = 0;
      connectionAccepted = false;
      void chrome.storage.local.remove(["sessionToken"]);
      setState({ connected: false, message: event.code === 4004 ? "连接已撤销，需要重新配对。" : "配对码已失效，请从桌面端重新发起。" });
      return;
    }
    setState({ connected: false, message: "连接已断开，正在尝试恢复…" });
  };
  return { connected: true, message: "正在连接" };
}

async function connectAndConfirm(wssUrl, code, sessionToken) {
  const wasAccepted = connectionAccepted;
  const startedAt = Date.now();
  const response = await connect(wssUrl, code, sessionToken);
  if (!response.connected) return response;
  if (wasAccepted && connectionAccepted) return currentState;

  while (Date.now() - startedAt < CONNECT_TIMEOUT_MS) {
    if (connectionAccepted) return currentState;
    if (!socket || socket.readyState === WebSocket.CLOSED) return currentState;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  socket?.close(4000, "Pairing timed out");
  return { connected: false, message: "服务器未确认配对，请回到桌面重新发起。" };
}

async function scheduleReconnect() {
  if (userRequestedDisconnect || reconnectTimer) return;
  const stored = await chrome.storage.local.get(["wssUrl", "sessionToken"]);
  if (!stored.wssUrl || !stored.sessionToken) return;

  const delay = getReconnectDelay(reconnectAttempt);
  if (delay === null) {
    setState({ connected: false, message: "自动重连次数已用完，请从桌面端重新连接。" });
    return;
  }

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    reconnectAttempt += 1;
    void connectAndConfirm(stored.wssUrl, "", stored.sessionToken);
  }, delay);
}

function isPairingPage(value) {
  try {
    const url = new URL(String(value ?? ""));
    const isSupportedOrigin = url.origin === "https://studio.0st.top"
      || (url.protocol === "http:" && ["localhost:3000", "localhost:3103"].includes(url.host));
    return isSupportedOrigin && url.pathname === PAIRING_PAGE_PATH;
  } catch {
    return false;
  }
}

async function restorePreviousTab() {
  const pairingId = pairingTabId;
  const targetTab = returnTabId;
  const targetWindow = returnWindowId;
  pairingTabId = null;
  returnTabId = null;
  returnWindowId = null;
  if (pairingId == null) return;

  await chrome.tabs.remove(pairingId).catch(() => undefined);
  if (targetTab != null && targetWindow != null) {
    await chrome.tabs.update(targetTab, { active: true }).catch(() => undefined);
    await chrome.windows.update(targetWindow, { focused: true }).catch(() => undefined);
  }
}

chrome.tabs.onUpdated.addListener((tabId, _changeInfo, tab) => {
  if (isPairingPage(tab.url)) pairingTabId = tabId;
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  void chrome.tabs.get(tabId).then((tab) => {
    if (!isPairingPage(tab.url)) {
      lastActiveTabId = tabId;
      lastActiveWindowId = tab.windowId;
    }
  }).catch(() => undefined);
});

void chrome.tabs.query({ active: true, lastFocusedWindow: true }).then((tabs) => {
  const tab = tabs[0];
  if (tab?.id != null && !isPairingPage(tab.url)) {
    lastActiveTabId = tab.id;
    lastActiveWindowId = tab.windowId;
  }
}).catch(() => undefined);

function safeWssUrl(value) {
  try {
    const url = new URL(String(value ?? ""));
    const localDevelopment = url.protocol === "ws:" && ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
    if (url.protocol !== "wss:" && !localDevelopment) return null;
    if (url.username || url.password || url.pathname !== "/api/website-capture/assistant/ws") return null;
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

async function activeTab() {
  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tabs[0];
}

async function collectFacts(tabId) {
  const result = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, 500);
      const links = [...document.querySelectorAll("a[href]")].map((anchor) => anchor.href).filter((href) => /^https?:\/\//i.test(href));
      return {
        url: location.href,
        title: clean(document.title) || location.hostname,
        description: clean(document.querySelector('meta[name="description"]')?.content ?? document.querySelector('meta[property="og:description"]')?.content),
        headings: [...document.querySelectorAll("h1,h2,h3")].map((node) => clean(node.textContent)).filter(Boolean).slice(0, 16),
        navigation: [...document.querySelectorAll("header a,nav a")].map((node) => clean(node.textContent)).filter(Boolean).slice(0, 24),
        links: [...new Set(links)].slice(0, 80),
      };
    },
  });
  return result[0]?.result;
}

async function screenshot(tab) {
  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "jpeg", quality: 76 });
  return dataUrl;
}

async function ensureOffscreen() {
  if (chrome.offscreen && !(await chrome.offscreen.hasDocument())) {
    await chrome.offscreen.createDocument({
      url: "src/offscreen.html",
      reasons: ["USER_MEDIA"],
      justification: "Record the selected browser tab only after the workspace user requested a website capture.",
    });
  }
}

async function startRecording(tabId) {
  try {
    await ensureOffscreen();
    const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
    if (pendingRecording) pendingRecording.done = new Promise((resolve) => { recordingWaitResolve = resolve; });
    chrome.runtime.sendMessage({ type: "recording.start", streamId });
  } catch (error) {
    send({ type: "website_capture.recording_failed", taskId: pendingRecording?.taskId, message: error instanceof Error ? error.message : "录屏权限不可用" });
  }
}

function send(payload) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
}

async function captureTask(task) {
  const tab = await activeTab();
  if (!tab?.id || !tab.url || !/^https?:\/\//i.test(tab.url)) {
    send({ type: "website_capture.failed", taskId: task.taskId, message: "请在当前标签页手动打开准确的 HTTP(S) URL。" });
    return;
  }
  const expected = new URL(task.startUrl);
  const current = new URL(tab.url);
  if (expected.origin !== current.origin || expected.pathname !== current.pathname || expected.search !== current.search) {
    send({ type: "website_capture.failed", taskId: task.taskId, message: "当前标签页 URL 与任务输入不一致，请手动打开准确 URL 后重试。" });
    return;
  }
  const queue = [task.startUrl];
  const visited = new Set();
  taskTabs.set(task.taskId, tab.id);
  pendingRecording = { taskId: task.taskId };
  if (task.recordVideo) void startRecording(tab.id);
  try {
    while (queue.length && visited.size < task.pageLimit) {
      const next = queue.shift();
      if (!next || visited.has(next)) continue;
      visited.add(next);
      if (new URL(next).toString() !== new URL(tab.url ?? next).toString()) {
        await chrome.tabs.update(tab.id, { url: next });
        await new Promise((resolve) => setTimeout(resolve, 900));
      }
      const loadedUrl = new URL(tab.url ?? next);
      if (!isAllowedDestination(loadedUrl, expected, task.followExternal)) throw new Error("自动跟链或重定向扩展到了未授权的本地地址。");
      const page = await collectFacts(tab.id);
      const screenshotBase64 = await screenshot(tab);
      send({ type: "website_capture.page", taskId: task.taskId, page, screenshotBase64 });
      send({ type: "website_capture.progress", taskId: task.taskId, progress: 10 + Math.round((visited.size / task.pageLimit) * 70), stage: "page_loading", detail: `已读取 ${visited.size}/${task.pageLimit} 个页面` });
      if (task.followExternal || new URL(next).hostname === expected.hostname) {
        for (const link of page?.links ?? []) {
          const linkUrl = new URL(link);
          if (isAllowedDestination(linkUrl, expected, task.followExternal) && !visited.has(link) && !queue.includes(link)) queue.push(link);
          if (queue.length >= task.pageLimit * 3) break;
        }
      }
    }
    if (task.recordVideo) {
      const recordingDone = pendingRecording?.done;
      send({ type: "recording.stop" });
      if (recordingDone) await Promise.race([recordingDone, new Promise((resolve) => setTimeout(resolve, 8000))]);
    }
    send({ type: "website_capture.complete", taskId: task.taskId, recordingBase64: pendingRecording?.base64 });
  } catch (error) {
    send({ type: "website_capture.failed", taskId: task.taskId, message: error instanceof Error ? error.message : "本地浏览失败" });
  } finally {
    pendingRecording = null;
    taskTabs.delete(task.taskId);
  }
}

function isPrivateHost(value) {
  const hostname = String(value ?? "").toLowerCase().replace(/^\[|\]$/g, "");
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local") || hostname.endsWith(".internal")) return true;
  if (hostname === "::1" || hostname === "0.0.0.0" || hostname.startsWith("127.") || /^10\./.test(hostname) || /^192\.168\./.test(hostname) || /^169\.254\./.test(hostname)) return true;
  const private172 = hostname.match(/^172\.(\d{1,3})\./);
  return Boolean((private172 && Number(private172[1]) >= 16 && Number(private172[1]) <= 31) || /^(fc|fd|fe80):/i.test(hostname));
}

function isAllowedDestination(url, expected, followExternal) {
  if (!isPrivateHost(url.hostname) || url.hostname.toLowerCase() === expected.hostname.toLowerCase()) return followExternal || url.hostname.toLowerCase() === expected.hostname.toLowerCase();
  return url.hostname.toLowerCase() === expected.hostname.toLowerCase();
}

function needsApproval(action) {
  return ["upload", "download", "publish", "purchase", "payment", "authorize", "submit"].includes(action?.kind)
    || action?.kind === "fill"
    || action?.sideEffect === true
    || action?.kind === "click";
}

function safeHttpUrl(value) {
  try {
    const url = new URL(String(value ?? ""));
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.toString() : null;
  } catch {
    return null;
  }
}

function safeEvidenceUrl(value) {
  const safe = safeHttpUrl(value);
  if (!safe) return null;
  const url = new URL(safe);
  url.search = "";
  url.hash = "";
  return url.toString();
}

async function hasCredentialControls(tabId) {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => [...document.querySelectorAll("input")].some((input) => {
      const hints = [input.type, input.name, input.id, input.autocomplete, input.getAttribute("aria-label"), input.placeholder]
        .filter(Boolean).join(" ").toLowerCase().replace(/[\s_]+/g, "-");
      return input.type === "password" || /password|passcode|one-time-code|otp|verification-code|auth-code|mfa/.test(hints);
    }),
  });
  return result?.result === true;
}

function emitDesktopAgentEvent(taskId, eventType, fields = {}) {
  send({ type: "desktop_agent.event", taskId, eventType, ...fields });
}

function desktopActionNeedsApproval(action) {
  return ["click", "type", "native_click", "native_type", "start_recording", "stop_recording"].includes(action?.kind);
}

async function captureDesktopAgentEvidence(task, tabId) {
  const [pageResult] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, 500);
      const url = new URL(location.href);
      url.search = "";
      url.hash = "";
      return {
        url: url.toString(),
        title: clean(document.title) || location.hostname,
        description: clean(document.querySelector('meta[name="description"]')?.content ?? document.querySelector('meta[property="og:description"]')?.content),
        headings: [...document.querySelectorAll("h1,h2,h3")].map((node) => clean(node.textContent)).filter(Boolean).slice(0, 16),
        navigation: [...document.querySelectorAll("header a,nav a")].map((node) => clean(node.textContent)).filter(Boolean).slice(0, 24),
      };
    },
  });
  const page = pageResult?.result;
  if (!page || !safeEvidenceUrl(page.url)) throw new Error("The active tab did not expose a safe HTTP(S) page snapshot.");
  const credentialControls = await hasCredentialControls(tabId);
  const screenshotBase64 = credentialControls ? undefined : (await screenshot(await chrome.tabs.get(tabId))).replace(/^data:image\/jpeg;base64,/i, "");
  const summary = [page.title, page.description, ...(page.headings ?? []).slice(0, 5)].filter(Boolean).join("\n").slice(0, 8_000);
  return {
    summary: `${summary}${credentialControls ? "\nScreenshot omitted because the page contains a credential or verification control." : ""}`,
    page: { ...page, url: safeEvidenceUrl(page.url) },
    evidence: [{ kind: "page", sourceUrl: safeEvidenceUrl(page.url), title: page.title, excerpt: summary }],
    ...(screenshotBase64 ? { screenshotBase64 } : {}),
  };
}

async function startDesktopAgentTask(task) {
  if (!task || task.executionMode !== "connected_browser_tab" || !Array.isArray(task.plannedActions)) {
    throw new Error("The browser extension only accepts connected-tab Agent tasks.");
  }
  const tab = await activeTab();
  if (!tab?.id || !safeHttpUrl(tab.url)) throw new Error("Select an HTTP(S) Edge/Chrome tab before starting the task.");
  if (task.targetUrl) {
    const target = safeHttpUrl(task.targetUrl);
    if (!target) throw new Error("The requested target must be a credential-free HTTP(S) URL.");
    if (new URL(target).origin !== new URL(tab.url).origin || new URL(target).pathname !== new URL(tab.url).pathname) {
      await chrome.tabs.update(tab.id, { url: target });
      await new Promise((resolve) => setTimeout(resolve, 800));
    }
  }
  desktopAgentTasks.set(task.taskId, { task, tabId: tab.id, actions: [...task.plannedActions] });
  emitDesktopAgentEvent(task.taskId, "plan", { progress: 5, detail: "Inspect the user-authorized browser tab and follow the approved task plan." });
  emitDesktopAgentEvent(task.taskId, "step", { stepId: "inspect-page", progress: 30, detail: "Read the current page and check for credential controls." });
  const result = await captureDesktopAgentEvidence(task, tab.id);
  emitDesktopAgentEvent(task.taskId, "evidence", { stepId: "inspect-page", progress: 55, detail: "Page evidence captured from the authorized tab.", result });
  await continueDesktopAgentTask(task.taskId);
}

async function continueDesktopAgentTask(taskId) {
  const state = desktopAgentTasks.get(taskId);
  if (!state) return;
  const action = state.actions[0];
  if (!action) {
    const result = await captureDesktopAgentEvidence(state.task, state.tabId);
    emitDesktopAgentEvent(taskId, "completed", { progress: 100, detail: "Browser task completed with evidence.", result });
    desktopAgentTasks.delete(taskId);
    return;
  }
  if (desktopActionNeedsApproval(action) && !action.approvalToken) {
    emitDesktopAgentEvent(taskId, "approval_required", { action, detail: `Approval required before ${action.kind}.` });
    return;
  }
  await executeDesktopAgentAction({ taskId, action });
}

async function executeDesktopAgentAction(message) {
  const state = desktopAgentTasks.get(String(message.taskId ?? ""));
  const action = message.action;
  if (!state || !action || action.taskId !== state.task.taskId) throw new Error("The desktop task or action is no longer active.");
  if (isCredentialAction(action)) throw new Error("Credential and verification fields are blocked.");
  if (desktopActionNeedsApproval(action) && !action.approvalToken) throw new Error("This action requires an approval token.");
  const tabId = state.tabId;
  if (action.kind === "navigate") {
    const target = safeHttpUrl(action.targetUrl);
    if (!target) throw new Error("Only credential-free HTTP(S) navigation is allowed.");
    await chrome.tabs.update(tabId, { url: target });
  } else if (action.kind === "scroll") {
    await chrome.scripting.executeScript({ target: { tabId }, func: (top) => window.scrollTo({ top, behavior: "instant" }), args: [Number(action.top) || 0] });
  } else if (action.kind === "click") {
    const selector = String(action.target ?? "");
    if (!selector || selector.length > 500) throw new Error("The click selector is missing or too long.");
    await chrome.scripting.executeScript({ target: { tabId }, func: (value) => {
      const element = document.querySelector(value);
      if (!(element instanceof HTMLElement)) throw new Error("The requested click target was not found.");
      element.click();
    }, args: [selector] });
  } else if (action.kind === "type") {
    const [execution] = await chrome.scripting.executeScript({ target: { tabId }, func: fillPageField, args: [{ selector: String(action.target ?? ""), value: String(action.value ?? "") }] });
    if (!execution?.result?.ok) throw new Error(execution?.result?.message ?? "The requested field could not be filled.");
  } else if (action.kind === "read_page" || action.kind === "capture_screen") {
    // Evidence is collected again when the task finishes.
  } else {
    throw new Error(`Action ${String(action.kind)} is not supported by the browser extension.`);
  }
  if (state.actions[0]?.requestId === action.requestId) state.actions.shift();
  emitDesktopAgentEvent(action.taskId, "progress", {
    progress: 75,
    detail: `Completed ${action.kind}.`,
    ...(action.approvalId ? { approvalId: action.approvalId } : {}),
    action,
  });
  await continueDesktopAgentTask(action.taskId);
}

async function executeApprovedAction(message) {
  const action = message.action && typeof message.action === "object" ? message.action : null;
  const actionId = String(message.actionId ?? "");
  const tabId = taskTabs.get(String(message.taskId ?? ""));
  if (!action || !tabId || (needsApproval(action) && !message.approvalToken) || (actionId && consumedApprovalIds.has(actionId))) return;
  if (isCredentialAction(action)) {
    if (actionId) send({ type: "website_capture.action_result", actionId, taskId: message.taskId, approvalToken: message.approvalToken, action: websiteActionReceipt(action), ok: false, message: "密码、OTP 和验证码字段始终禁止自动填写。" });
    return;
  }
  if (actionId) consumedApprovalIds.add(actionId);
  let ok = false;
  let resultMessage = "动作未执行";
  try {
    if (action.kind === "navigate") {
      const targetUrl = safeHttpUrl(action.targetUrl);
      if (!targetUrl) throw new Error("只允许导航到 HTTP(S) 地址。");
      await chrome.tabs.update(tabId, { url: targetUrl });
      ok = true;
      resultMessage = "已导航";
    } else if (action.kind === "scroll") {
      await chrome.scripting.executeScript({ target: { tabId }, func: (top) => window.scrollTo({ top: Number(top) || 0, behavior: "instant" }), args: [Number(action.top) || 0] });
      ok = true;
      resultMessage = "已滚动";
    } else if (action.kind === "click") {
      const selector = String(action.target ?? "");
      if (!selector || selector.length > 500) throw new Error("缺少安全的点击目标。");
      await chrome.scripting.executeScript({ target: { tabId }, func: (value) => {
        const element = document.querySelector(value);
        if (!(element instanceof HTMLElement)) throw new Error("点击目标不存在。");
        element.click();
      }, args: [selector] });
      ok = true;
      resultMessage = "已点击";
    } else if (action.kind === "fill") {
      const selector = String(action.target ?? "");
      if (!selector || selector.length > 500 || typeof action.value !== "string") throw new Error("缺少安全的填写目标或内容。");
      const [execution] = await chrome.scripting.executeScript({
        target: { tabId },
        func: fillPageField,
        args: [{ selector, value: action.value }],
      });
      if (!execution?.result?.ok) throw new Error(execution?.result?.message ?? "填写目标不存在。");
      ok = true;
      resultMessage = "已填写";
    } else {
      throw new Error("此动作类型不支持自动执行。");
    }
  } catch (error) {
    resultMessage = error instanceof Error ? error.message : "动作执行失败";
  }
  if (actionId) send({ type: "website_capture.action_result", actionId, taskId: message.taskId, approvalToken: message.approvalToken, action: websiteActionReceipt(action), ok, message: resultMessage });
}

async function handleServerMessage(message) {
  if (message.type === "assistant.connected") {
    connectionAccepted = true;
    reconnectAttempt = 0;
    if (message.sessionToken) await chrome.storage.local.set({ sessionToken: message.sessionToken });
    await restorePreviousTab();
    setState({ connected: true, message: "已连接，等待浏览任务" });
  }
  if (message.type === "website_capture.start") await captureTask(message);
  if (message.type === "desktop_agent.task") {
    try {
      await startDesktopAgentTask(message.task);
    } catch (error) {
      const taskId = String(message.task?.taskId ?? "");
      if (taskId) {
        desktopAgentTasks.delete(taskId);
        emitDesktopAgentEvent(taskId, "failed", { detail: error instanceof Error ? error.message : "Browser Agent task failed." });
      }
    }
  }
  if (message.type === "desktop_agent.action") {
    try {
      await executeDesktopAgentAction(message);
    } catch (error) {
      const taskId = String(message.action?.taskId ?? "");
      desktopAgentTasks.delete(taskId);
      emitDesktopAgentEvent(taskId, "failed", {
        detail: error instanceof Error ? error.message : "Approved browser action failed.",
        ...(message.action?.approvalId ? { approvalId: message.action.approvalId } : {}),
        action: message.action,
      });
    }
  }
  if (message.type === "desktop_agent.action_denied") {
    const taskId = String(message.taskId ?? "");
    desktopAgentTasks.delete(taskId);
    emitDesktopAgentEvent(taskId, "failed", { detail: String(message.reason ?? "The action was not approved.") });
  }
  if (message.type === "desktop_agent.stop") {
    const taskId = String(message.taskId ?? "");
    desktopAgentTasks.delete(taskId);
    emitDesktopAgentEvent(taskId, "failed", { detail: String(message.reason ?? "The task was canceled.") });
  }
  if (message.type === "assistant.pause") setState({ message: "已暂停，等待恢复" });
  if (message.type === "assistant.resume") setState({ message: "已连接，等待浏览任务" });
  if (message.type === "website_capture.stop") {
    send({ type: "recording.stop" });
    send({ type: "website_capture.failed", taskId: message.taskId, message: "用户停止了本地浏览任务" });
  }
  if (message.type === "website_capture.action_execute") await executeApprovedAction(message);
  if (message.type === "website_capture.scroll") {
    const tab = await activeTab();
    if (tab?.id) await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: (top) => window.scrollTo({ top, behavior: "instant" }), args: [Number(message.top) || 0] });
  }
  if (message.type === "website_capture.click") {
    send({ type: "website_capture.side_effect", taskId: message.taskId, reason: "点击动作需要在 Helstera 确认卡中明确批准。" });
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "assistant.connect") {
    if (isPairingPage(sender.url) && sender.tab?.id != null) {
      pairingTabId = sender.tab.id;
      returnTabId = lastActiveTabId === pairingTabId ? null : lastActiveTabId;
      returnWindowId = returnTabId == null ? null : lastActiveWindowId;
    }
    void connectAndConfirm(message.wssUrl, message.code).then(sendResponse);
    return true;
  }
  if (message.type === "assistant.disconnect") {
    userRequestedDisconnect = true;
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
    reconnectAttempt = 0;
    connectionAccepted = false;
    send({ type: "assistant.disconnect" });
    socket?.close(1000, "User disconnected");
    void chrome.storage.local.remove(["sessionToken"]);
    setState({ connected: false, message: "已断开" });
    sendResponse(currentState);
  }
  if (message.type === "assistant.state") sendResponse(currentState);
  if (message.type === "recording.complete") {
    if (pendingRecording) pendingRecording.base64 = message.base64;
    recordingWaitResolve?.();
    recordingWaitResolve = null;
  }
  if (message.type === "recording.failed") send({ type: "website_capture.recording_failed", taskId: pendingRecording?.taskId, message: message.message });
});

chrome.runtime.onStartup.addListener(async () => {
  const stored = await chrome.storage.local.get(["wssUrl", "sessionToken"]);
  if (stored.wssUrl && stored.sessionToken) void connectAndConfirm(stored.wssUrl, "", stored.sessionToken);
});
