(() => {
  const path = "/desktop-browser-pair.html";
  const isLocalOrigin = location.protocol === "http:"
    && ["localhost:3000", "localhost:3103"].includes(location.host);
  const isProductionOrigin = location.origin === "https://studio.0st.top";
  if ((!isProductionOrigin && !isLocalOrigin) || location.pathname !== path) return;

  const pairing = new URLSearchParams(location.hash.slice(1));
  const code = pairing.get("code");
  const wssUrl = pairing.get("wssUrl");
  history.replaceState(null, "", location.pathname);

  function updateStatus(text, state) {
    const status = document.querySelector("#pair-status");
    if (!status) return false;
    status.textContent = text;
    if (state) status.dataset.state = state;
    return true;
  }

  function showStatus(text, state) {
    if (updateStatus(text, state)) return;
    document.addEventListener("DOMContentLoaded", () => updateStatus(text, state), { once: true });
  }

  if (!code || !wssUrl) {
    showStatus("配对链接无效或已失效。请回到桌面端重新发起连接。", "failed");
    return;
  }

  showStatus("正在安全连接浏览器助手…");
  void chrome.runtime.sendMessage({ type: "assistant.connect", wssUrl, code })
    .then((result) => {
      if (!result?.connected) throw new Error(result?.message ?? "连接未建立");
      showStatus("浏览器助手已连接。正在返回你之前使用的标签页…", "connected");
    })
    .catch((error) => {
      showStatus(error instanceof Error ? error.message : "连接失败，请回到桌面重试。", "failed");
    });
})();
