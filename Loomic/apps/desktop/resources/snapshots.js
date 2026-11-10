const api = window.electronAPI, el = id => document.getElementById(id);
let snapshots = [], selected = null;
const message = error => { el("error").hidden = false; el("error").textContent = error.message.replace(/^Error invoking remote method '[^']+': Error: /, ""); };
function renderList() {
  el("list").replaceChildren();
  const query = el("search").value.trim().toLocaleLowerCase();
  const filtered = snapshots.filter(item => `${item.name} ${item.fileName}`.toLocaleLowerCase().includes(query));
  for (const item of filtered) {
    const button = document.createElement("button"), image = document.createElement("img"), title = document.createElement("strong"), date = document.createElement("small");
    image.src = item.thumbnail; image.alt = "画布结构缩略图"; title.textContent = item.name; date.textContent = `${new Date(item.savedAt).toLocaleString()} · ${item.elements} 个元素 · ${item.messages} 条消息`;
    button.append(image, title, date); button.addEventListener("click", () => inspect(item)); el("list").append(button);
  }
  el("status").textContent = `${filtered.length} 份本地快照 · 预览不会联网或上传素材`;
}
async function refresh() {
  el("error").hidden = true; el("status").textContent = "正在读取本地文件…"; el("preview").hidden = true;
  try {
    if (!el("account").value) { snapshots = []; renderList(); return; }
    const list = await api.listLocalSnapshots({ accountId: el("account").value, accessToken: "" }); snapshots = list.snapshots; renderList();
    if (list.unreadable || list.truncated) el("status").textContent += `；${list.unreadable} 份记录不可读${list.truncated ? "，本次列表已达上限" : ""}`;
  } catch (error) { message(error); }
}
function paragraphs(target, values) { target.replaceChildren(); for (const text of values) { const p = document.createElement("p"); p.textContent = text; target.append(p); } if (!values.length) target.textContent = "此快照没有相关内容。"; }
async function inspect(item, baseline) {
  el("error").hidden = true;
  try {
    const overview = await api.getLocalSnapshotOverview(item.id, el("account").value, baseline); selected = item; el("preview").hidden = false; el("name").textContent = overview.name; el("thumbnail").src = overview.thumbnail;
    el("baseline").replaceChildren(...[{ id: "", fileName: "自动比较较早版本" }, ...overview.versions].map(version => { const option = document.createElement("option"); option.value = version.id; option.textContent = version.savedAt ? `${new Date(version.savedAt).toLocaleString()} · ${version.fileName}` : version.fileName; return option; })); el("baseline").value = baseline || "";
    const diff = overview.difference;
    el("diff").textContent = diff ? `相较 ${new Date(overview.baseline.savedAt).toLocaleString()}：元素新增 ${diff.elements.added}、修改 ${diff.elements.changed}、移除 ${diff.elements.removed}；消息新增 ${diff.messages.added}、修改 ${diff.messages.changed}、移除 ${diff.messages.removed}。${diff.settingsChanged ? "画布设置有变化。" : ""}${diff.mediaChanged ? "素材引用有变化。" : ""}` : "没有其他版本可比较。";
    el("queued").textContent = ""; paragraphs(el("texts"), overview.text); el("messages").replaceChildren();
    for (const entry of overview.messages) { const article = document.createElement("article"), role = document.createElement("strong"), text = document.createElement("p"); role.textContent = entry.role === "user" ? "用户" : entry.role === "assistant" ? "助手" : "历史记录"; text.textContent = entry.content; article.append(role, text); el("messages").append(article); }
    if (overview.truncated) el("queued").textContent = "预览显示部分内容，完整记录保留在 JSON 文件中。";
  } catch (error) { message(error); }
}
el("queue").addEventListener("click", async () => { if (!selected) return; try { await api.queueLocalSnapshot(selected.id, el("account").value); el("queued").textContent = "已存入本地待恢复列表。联网后在设置的恢复任务中确认继续。"; } catch (error) { message(error); } });
el("baseline").addEventListener("change", () => { if (selected) void inspect(selected, el("baseline").value || undefined); });
el("refresh").addEventListener("click", refresh); el("account").addEventListener("change", refresh); el("search").addEventListener("input", renderList);
el("folder").addEventListener("click", () => api.openDesktopWorkspaceFolder().catch(message)); el("connect").addEventListener("click", () => api.enterDesktopWorkspace().catch(message)); el("minimize").addEventListener("click", () => api.minimizeWindow()); el("close").addEventListener("click", () => api.closeWindow());
api.getLocalSnapshotAccounts().then(accounts => { for (const account of accounts) { const option = document.createElement("option"); option.value = account; option.textContent = `本地账户 ${account.slice(0, 8)}`; el("account").append(option); } return refresh(); }).catch(message);
