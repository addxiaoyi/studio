(() => {
  const api = window.electronAPI, el = id => document.getElementById(id);
  const size = bytes => bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GiB` : bytes >= 1024 ** 2 ? `${(bytes / 1024 ** 2).toFixed(1)} MiB` : `${(bytes / 1024).toFixed(1)} KiB`;
  const labels = { media: "素材原文件", projects: "工程与对话快照", exports: "导出成片", cache: "预览缓存", other: "其他文件" };
  const status = text => { el("usage-status").textContent = text; };
  const cacheUsage = async () => {
    el("cache-capacity").disabled = true; el("cache-save").disabled = true;
    try {
    const usage = await api.getThumbnailUsage(el("account").value);
    el("cache-status").textContent = `当前账户封面 ${size(usage.bytes)} · ${usage.files} 张；工作区总缓存 ${size(usage.workspaceBytes)} / ${size(usage.limitBytes)}，最多 ${usage.limitFiles} 张，${usage.retentionDays} 天未使用自动淘汰。`;
    el("cache-capacity").value = String(usage.limitBytes / 1024 ** 2);
    const cleanup = usage.lastCleanup;
    el("cache-cleanup").textContent = cleanup ? `上次${{ automatic: "自动淘汰", manual: "手动清理", settings: "调整容量" }[cleanup.reason]}：${new Date(cleanup.at).toLocaleString()} · ${cleanup.files} 张 · ${size(cleanup.bytes)}` : "尚无清理记录。";
    if (!usage.enabled) el("cache-cleanup").textContent += " 封面缓存已关闭，仍可打开原文件。";
    } finally { el("cache-capacity").disabled = false; el("cache-save").disabled = false; }
  };
  const progress = state => {
    if (!state || state.accountId !== el("account").value) return;
    const running = state.phase === "hashing" || state.phase === "discovering";
    el("usage-scan").disabled = running; el("usage-duplicates").disabled = running; el("usage-cancel").hidden = !running; el("usage-reset").disabled = running;
    el("usage-duplicates").textContent = state.phase === "paused" ? "继续校验重复素材" : "校验重复素材";
    el("usage-progress").textContent = `${state.phase === "paused" ? "已暂停，可退出应用后继续。" : state.phase === "completed" ? "扫描完成，再次校验会复用未改变的内容。" : "正在校验"} ${size(state.verifiedBytes)} / ${size(state.totalBytes)} · 已复用 ${size(state.reusedBytes)} ${state.fileName}`;
  };
  api.onWorkspaceScan(progress);
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
  el("usage-reset").addEventListener("click", async () => { try { await api.clearWorkspaceScan(el("account").value); el("usage-progress").textContent = ""; el("usage-duplicates").textContent = "校验重复素材"; status("扫描进度已清除，素材原文件保留。"); } catch (error) { status(error.message); } });
  el("cache-save").addEventListener("click", async () => { el("cache-save").disabled = true; try { await api.configureThumbnailCache(el("account").value, { capacityMiB: Number(el("cache-capacity").value) }); await cacheUsage(); status("缓存容量已保存，超出上限的封面已清理，原文件保留。"); } catch (error) { status(error.message); } finally { el("cache-save").disabled = false; } });
  el("cache-clear").addEventListener("click", async () => { el("cache-clear").disabled = true; try { const cleared = await api.clearThumbnailCache(el("account").value); await cacheUsage(); el("usage-result").replaceChildren(); status(`已清理 ${size(cleared.bytes)} 封面缓存，原文件保留。`); } catch (error) { status(error.message); } finally { el("cache-clear").disabled = false; } });
  el("manage").addEventListener("click", () => { el("usage-result").replaceChildren(); status(""); el("usage-progress").textContent = ""; void cacheUsage().catch(error => status(error.message)); void api.getWorkspaceScanState(el("account").value).then(progress).catch(error => status(error.message)); });
})();
