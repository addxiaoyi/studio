const api = window.electronAPI, el = id => document.getElementById(id);
let snapshots = [], selected = null, previewRevision = 0;
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
  el("error").hidden = true; el("status").textContent = "正在读取本地文件…"; el("preview").hidden = true; previewRevision++; window.stopSnapshotMedia?.(); el("media-preview").replaceChildren();
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
    el("queued").textContent = ""; renderMedia(overview.media || []); paragraphs(el("texts"), overview.text); el("messages").replaceChildren();
    for (const entry of overview.messages) { const article = document.createElement("article"), role = document.createElement("strong"), text = document.createElement("p"); role.textContent = entry.role === "user" ? "用户" : entry.role === "assistant" ? "助手" : "历史记录"; text.textContent = entry.content; article.append(role, text); el("messages").append(article); }
    if (overview.truncated) el("queued").textContent = "预览显示部分内容，完整记录保留在 JSON 文件中。";
  } catch (error) { message(error); }
}
el("queue").addEventListener("click", async () => { if (!selected) return; try { await api.queueLocalSnapshot(selected.id, el("account").value); el("queued").textContent = "已存入本地待恢复列表。联网后在设置的恢复任务中确认继续。"; } catch (error) { message(error); } });
el("baseline").addEventListener("change", () => { if (selected) void inspect(selected, el("baseline").value || undefined); });
el("refresh").addEventListener("click", refresh); el("account").addEventListener("change", refresh); el("search").addEventListener("input", renderList);
el("folder").addEventListener("click", () => api.openDesktopWorkspaceFolder().catch(message)); el("connect").addEventListener("click", () => api.enterDesktopWorkspace().catch(message)); el("minimize").addEventListener("click", () => api.minimizeWindow()); el("close").addEventListener("click", () => api.closeWindow());
api.getLocalSnapshotAccounts().then(accounts => { for (const account of accounts) { const option = document.createElement("option"); option.value = account; option.textContent = `本地账户 ${account.slice(0, 8)}`; el("account").append(option); } return refresh(); }).catch(message);

function renderMedia(media) {
  previewRevision++;
  window.showSnapshotMedia(media, { id: selected.id, account: el("account").value });
}

async function refreshDisk() {
  try {
    const disk = await api.getDesktopSetup();
    el("disk").textContent = disk.availableBytes === undefined ? "工作区暂不可用，请重新连接磁盘。" : `本地磁盘可用 ${(disk.availableBytes / 1024 ** 3).toFixed(1)} GiB${disk.diskWarning === "critical" ? " · 空间严重不足，请先清理或切换磁盘。" : disk.diskWarning === "low" ? " · 空间偏低，建议整理旧工程。" : ""}`;
    el("disk").dataset.warning = disk.diskWarning || "normal";
  } catch (error) { message(error); }
}
let cleanupPlan = null, clearing = false;
el("manage").addEventListener("click", async () => {
  el("cleanup-dialog").showModal(); el("cleanup-list").replaceChildren(); el("cleanup-plan").hidden = true; el("cleanup-status").textContent = "正在读取本地工程…";
  try {
    const projects = await api.getLocalProjects(el("account").value);
    for (const project of projects) {
      const button = document.createElement("button"); button.textContent = `${project.name} · ${project.snapshots} 份快照 · 检查清理范围`;
      button.addEventListener("click", async () => {
        button.disabled = true; el("cleanup-status").textContent = "正在校验文件与共用关系…";
        try {
          cleanupPlan = await api.previewLocalCleanup(el("account").value, project.id);
          el("cleanup-summary").textContent = `${cleanupPlan.name}：${cleanupPlan.snapshots} 份快照、${cleanupPlan.mediaFiles} 个专属素材，合计 ${(cleanupPlan.bytes / 1024 ** 2).toFixed(1)} MiB。保留 ${cleanupPlan.sharedMedia} 个共用素材。${cleanupPlan.canceledTasks ? `同时移除 ${cleanupPlan.canceledTasks} 条尚未上传的待恢复记录。` : ""}`;
          el("cleanup-files").replaceChildren(...cleanupPlan.files.map(name => { const li = document.createElement("li"); li.textContent = name; return li; }));
          el("cleanup-plan").hidden = false; el("cleanup-accept").checked = false; el("cleanup-confirm").disabled = true; el("cleanup-status").textContent = "";
        } catch (error) { el("cleanup-status").textContent = error.message; }
        finally { button.disabled = false; }
      });
      el("cleanup-list").append(button);
    }
    el("cleanup-status").textContent = projects.length ? "" : "当前账户没有可清理的本地工程。";
  } catch (error) { el("cleanup-status").textContent = error.message; }
});
el("cleanup-accept").addEventListener("change", () => { el("cleanup-confirm").disabled = !el("cleanup-accept").checked; });
el("cleanup-close").addEventListener("click", () => { if (!clearing) el("cleanup-dialog").close(); });
el("cleanup-dialog").addEventListener("cancel", event => { if (clearing) event.preventDefault(); });
el("cleanup-confirm").addEventListener("click", async () => {
  if (!cleanupPlan || !el("cleanup-accept").checked || clearing) return;
  clearing = true; el("cleanup-confirm").disabled = true; el("cleanup-close").disabled = true;
  try {
    const cleared = await api.applyLocalCleanup(cleanupPlan.id);
    el("cleanup-status").textContent = `已清理 ${cleared.removedFiles} 个文件，合计 ${(cleared.removedBytes / 1024 ** 2).toFixed(1)} MiB。${cleared.errors.join(" ")}`;
    el("cleanup-list").replaceChildren(); await refresh(); await refreshDisk();
  } catch (error) { el("cleanup-status").textContent = error.message; }
  finally { cleanupPlan = null; clearing = false; el("cleanup-plan").hidden = true; el("cleanup-close").disabled = false; }
});
void refreshDisk();
