let socket = null;
let currentState = { connected: false, message: "未连接" };
let pendingRecording = null;
let recordingWaitResolve = null;
const taskTabs = new Map();
const consumedApprovalIds = new Set();

function setState(next) {
  currentState = { ...currentState, ...next };
  chrome.runtime.sendMessage({ type: "assistant.state", state: currentState }).catch(() => undefined);
}

async function connect(wssUrl, code, sessionToken) {
  if (socket && socket.readyState === WebSocket.OPEN) return { ...currentState, message: "已经连接" };
  const safeUrl = safeWssUrl(wssUrl);
  if (!safeUrl) return { connected: false, message: "只允许连接 Helstera 的 WSS 助手地址" };
  const separator = wssUrl.includes("?") ? "&" : "?";
  const credential = sessionToken
    ? `session_token=${encodeURIComponent(sessionToken)}`
    : `code=${encodeURIComponent(code)}`;
  socket = new WebSocket(`${safeUrl}${separator}${credential}`);
  socket.onopen = async () => {
    setState({ connected: true, message: "已连接，等待浏览任务" });
    socket.send(JSON.stringify({ type: "assistant.ready", browser: navigator.userAgent, platform: navigator.platform }));
    await chrome.storage.local.set({ wssUrl });
  };
  socket.onmessage = (event) => {
    try { void handleServerMessage(JSON.parse(event.data)); } catch { setState({ message: "收到无法识别的服务器消息" }); }
  };
  socket.onerror = () => setState({ connected: false, message: "WSS 连接失败" });
  socket.onclose = () => { socket = null; setState({ connected: false, message: "连接已断开" }); };
  return { connected: true, message: "正在连接" };
}

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

function isCredentialField(action) {
  return ["password", "otp", "one-time-code", "verification-code"].includes(String(action?.fieldType ?? "").toLowerCase());
}

function needsApproval(action) {
  return ["upload", "download", "publish", "purchase", "payment", "authorize", "submit"].includes(action?.kind)
    || action?.kind === "fill"
    || action?.sideEffect === true
    || (action?.kind === "click" && !/link|navigation|menu|tab/i.test(String(action?.targetRole ?? "")));
}

function safeHttpUrl(value) {
  try {
    const url = new URL(String(value ?? ""));
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

async function executeApprovedAction(message) {
  const action = message.action && typeof message.action === "object" ? message.action : null;
  const actionId = String(message.actionId ?? "");
  const tabId = taskTabs.get(String(message.taskId ?? ""));
  if (!action || !tabId || (needsApproval(action) && !message.approvalToken) || (actionId && consumedApprovalIds.has(actionId))) return;
  if (isCredentialField(action)) {
    if (actionId) send({ type: "website_capture.action_result", actionId, taskId: message.taskId, approvalToken: message.approvalToken, action, ok: false, message: "密码、OTP 和验证码字段始终禁止自动填写。" });
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
      await chrome.scripting.executeScript({ target: { tabId }, func: (input) => {
        const element = document.querySelector(input.selector);
        if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement)) throw new Error("填写目标不存在。");
        element.value = input.value;
        element.dispatchEvent(new Event("input", { bubbles: true }));
        element.dispatchEvent(new Event("change", { bubbles: true }));
      }, args: [{ selector, value: action.value }] });
      ok = true;
      resultMessage = "已填写";
    } else {
      throw new Error("此动作类型不支持自动执行。");
    }
  } catch (error) {
    resultMessage = error instanceof Error ? error.message : "动作执行失败";
  }
  if (actionId) send({ type: "website_capture.action_result", actionId, taskId: message.taskId, approvalToken: message.approvalToken, action, ok, message: resultMessage });
}

async function handleServerMessage(message) {
  if (message.type === "assistant.connected") {
    if (message.sessionToken) await chrome.storage.local.set({ sessionToken: message.sessionToken });
    setState({ connected: true, message: "已连接，等待浏览任务" });
  }
  if (message.type === "website_capture.start") await captureTask(message);
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

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "assistant.connect") {
    void connect(message.wssUrl, message.code).then(sendResponse);
    return true;
  }
  if (message.type === "assistant.disconnect") {
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
  if (stored.wssUrl && stored.sessionToken) void connect(stored.wssUrl, "", stored.sessionToken);
});
