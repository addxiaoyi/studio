const state = new URLSearchParams(location.search).get("state");
if (state === "timeout") document.getElementById("title").textContent = "工作区连接时间较长";
if (state === "crashed") {
  document.getElementById("title").textContent = "工作区需要重新打开";
  document.getElementById("description").textContent = "页面意外停止了响应。重新连接后可恢复已保存的工程；尚未保存的页面改动可能需要重新操作。";
}
document.getElementById("minimize").addEventListener("click", () => window.electronAPI?.minimizeWindow());
document.getElementById("close").addEventListener("click", () => window.electronAPI?.closeWindow());
document.getElementById("snapshots").addEventListener("click", () => { window.electronAPI.openOfflineSnapshots().catch(error => { document.getElementById("local-error").textContent = error.message; }); });
