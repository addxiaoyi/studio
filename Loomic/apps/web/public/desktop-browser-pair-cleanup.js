window.setTimeout(() => {
  if (window.location.hash) {
    window.history.replaceState(null, "", window.location.pathname);
  }
  const status = document.querySelector("#pair-status");
  if (status?.textContent.includes("正在检查")) {
    status.textContent = "未检测到 Helstera 浏览器助手。请安装并启用 Helstera Local Browser Assistant 后重试。";
    status.dataset.state = "failed";
  }
}, 1_500);
