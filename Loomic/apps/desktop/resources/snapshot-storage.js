(() => {
  const api = window.electronAPI, el = id => document.getElementById(id);
  const size = bytes => bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GiB` : bytes >= 1024 ** 2 ? `${(bytes / 1024 ** 2).toFixed(1)} MiB` : `${(bytes / 1024).toFixed(1)} KiB`;
  const labels = { media: "素材原文件", projects: "工程与对话快照", exports: "导出成片", cache: "预览缓存", other: "其他文件" };
  const status = text => { el("usage-status").textContent = text; };
  const cacheUsage = async () => {
    const usage = await api.getThumbnailUsage(el("account").value);
    el("cache-status").textContent = `当前账户封面 ${size(usage.bytes)} · ${usage.files} 张；工作区总缓存 ${size(usage.workspaceBytes)} / ${size(usage.limitBytes)}，最多 ${usage.limitFiles} 张，${usage.retentionDays} 天未使用自动淘汰。`;
  };
  const scan = async duplicates => {
    el("usage-scan").disabled = true; el("usage-duplicates").disabled = true; el("usage-cancel").hidden = false; status("正在读取本地磁盘，内容校验可能需要一些时间…");
    try {
      const report = await api.getWorkspaceUsage(el("account").value, duplicates);
      el("usage-result").replaceChildren();
      for (const row of report.categories) { const p = document.createElement("p"); p.textContent = `${labels[row.id] || row.id}：${size(row.bytes)} · ${row.files} 个文件`; el("usage-result").append(p); }
      status(`合计 ${size(report.totalBytes)} · ${report.totalFiles} 个文件。发现 ${report.duplicateGroups} 组重复，额外副本约 ${size(report.duplicateBytes)}。${report.truncated ? "本次扫描达到上限，未覆盖全部内容。" : ""}`);
      for (const group of report.duplicates) {
        const details = document.createElement("details"), summary = document.createElement("summary"); summary.textContent = `${group.files.length} 个相同文件 · 额外 ${size(group.extraBytes)}`; details.append(summary);
        for (const file of group.files) { const p = document.createElement("p"), locate = document.createElement("button"); p.textContent = file.relativePath; locate.textContent = "定位文件"; locate.addEventListener("click", () => api.revealWorkspaceFile(file.id).catch(error => status(error.message))); p.append(locate); details.append(p); }
        el("usage-result").append(details);
      }
      for (const warning of report.warnings) { const p = document.createElement("p"); p.textContent = warning; el("usage-result").append(p); }
      await cacheUsage();
    } catch (error) { status(error.message); }
    finally { el("usage-scan").disabled = false; el("usage-duplicates").disabled = false; el("usage-cancel").hidden = true; }
  };
  el("usage-scan").addEventListener("click", () => void scan(false)); el("usage-duplicates").addEventListener("click", () => void scan(true));
  el("usage-cancel").addEventListener("click", () => api.cancelWorkspaceScan().catch(error => status(error.message)));
  el("cache-clear").addEventListener("click", async () => { el("cache-clear").disabled = true; try { const cleared = await api.clearThumbnailCache(el("account").value); await cacheUsage(); el("usage-result").replaceChildren(); status(`已清理 ${size(cleared.bytes)} 封面缓存，原文件保留。`); } catch (error) { status(error.message); } finally { el("cache-clear").disabled = false; } });
  el("manage").addEventListener("click", () => { el("usage-result").replaceChildren(); status(""); void cacheUsage().catch(error => status(error.message)); });
})();
