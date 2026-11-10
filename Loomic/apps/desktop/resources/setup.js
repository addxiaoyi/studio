const api = window.electronAPI;
const el = (id) => document.getElementById(id);
let ready = false;
function errorText(error) { el("error").hidden = false; el("error").textContent = error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': Error: /, "") : "配置失败，请重试。"; }
function folder(state) {
  ready = Boolean(state.root && state.available !== false);
  el("folder").textContent = state.root || "尚未选择文件夹";
  el("space").textContent = state.availableBytes ? `可用空间 ${(state.availableBytes / 1024 ** 3).toFixed(1)} GiB · 已验证可写入${state.diskWarning === "critical" ? " · 空间严重不足，请选择其他磁盘或先清理。" : state.diskWarning === "low" ? " · 空间偏低，建议整理后再保存大文件。" : ""}` : "";
  el("complete").disabled = !ready;
}
async function choose() {
  el("error").hidden = true; el("choose").disabled = true;
  try { const state = await api.chooseDesktopWorkspace(); if (state) folder(state); }
  catch (error) { errorText(error); }
  finally { el("choose").disabled = false; }
}
async function complete() {
  el("error").hidden = true; el("complete").disabled = true;
  el("status").textContent = "正在验证目录并保存配置…";
  try {
    await api.completeDesktopSetup({ autoBackup: el("backup").checked, agentAccess: el("agent").checked });
    el("status").textContent = "配置已保存，正在打开工作台…";
    await api.enterDesktopWorkspace();
  } catch (error) { errorText(error); el("status").textContent = ""; el("complete").disabled = !ready; }
}
el("choose").addEventListener("click", choose); el("complete").addEventListener("click", complete);
el("minimize").addEventListener("click", () => api.minimizeWindow()); el("close").addEventListener("click", () => api.closeWindow());
api.getDesktopSetup().then(state => { folder(state); el("backup").checked = state.autoBackup; el("agent").checked = state.agentAccess; if (state.error) errorText(new Error(state.error)); }).catch(errorText);
