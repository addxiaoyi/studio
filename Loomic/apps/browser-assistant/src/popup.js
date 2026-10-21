const codeInput = document.querySelector("#pairing-code");
const urlInput = document.querySelector("#wss-url");
const status = document.querySelector("#status");

function renderState(state) {
  status.textContent = state?.message ?? (state?.connected ? "已连接" : "未连接");
}

document.querySelector("#connect").addEventListener("click", async () => {
  const response = await chrome.runtime.sendMessage({
    type: "assistant.connect",
    wssUrl: urlInput.value.trim(),
    code: codeInput.value.trim(),
  });
  renderState(response);
});

document.querySelector("#disconnect").addEventListener("click", async () => {
  const response = await chrome.runtime.sendMessage({ type: "assistant.disconnect" });
  renderState(response);
});

chrome.runtime.sendMessage({ type: "assistant.state" }).then(renderState).catch(() => renderState({ message: "助手状态暂不可用" }));
