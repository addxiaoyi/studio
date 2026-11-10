(() => {
  const api = window.electronAPI, el = id => document.getElementById(id);
  const status = text => { el("batch-status").textContent = text; };
  const labels = { matched: "内容一致", ambiguous: "多个匹配，请选择位置", missing: "未找到匹配原文件", unchanged: "当前位置已验证", invalid: "缺少有效的原文件校验记录" };
  let plan = null, visible = 0, saving = false;
  const selected = new Map();
  const selectionCount = () => { el("batch-apply").disabled = saving || !selected.size; el("batch-apply").textContent = `确认关联所选 ${selected.size} 项`; };
  const appendRows = () => {
    for (const item of plan.items.slice(visible, visible + 40)) {
      const row = document.createElement("article"), name = document.createElement("strong"), note = document.createElement("p");
      name.textContent = item.name; note.textContent = labels[item.status]; row.append(name, note);
      if (["matched", "ambiguous"].includes(item.status)) {
        const choose = document.createElement("select"); choose.setAttribute("aria-label", `匹配位置：${item.name}`);
        choose.add(new Option("跳过此素材", ""));
        for (const candidate of item.candidates) choose.add(new Option(`${candidate.relativePath} · ${candidate.willCopy ? "复制并保留源文件" : "仅更新位置"}`, candidate.id));
        choose.value = selected.get(item.assetId) || "";
        choose.addEventListener("change", async () => {
          const previous = selected.get(item.assetId) || "";
          if (choose.value) selected.set(item.assetId, choose.value); else selected.delete(item.assetId);
          saving = true; selectionCount(); for (const select of el("batch-list").querySelectorAll("select")) select.disabled = true;
          try { await api.saveRelinkSelection(plan.id, [...selected].map(([assetId, candidateId]) => ({ assetId, candidateId }))); status("选择已保存在本机，可退出后继续确认。"); }
          catch (error) { if (previous) selected.set(item.assetId, previous); else selected.delete(item.assetId); choose.value = previous; status(error.message); }
          finally { saving = false; selectionCount(); for (const select of el("batch-list").querySelectorAll("select")) select.disabled = false; }
        }); row.append(choose);
      }
      el("batch-list").append(row);
    }
    visible += 40; el("batch-more").hidden = visible >= plan.items.length;
  };
  const reset = () => { plan = null; selected.clear(); visible = 0; el("batch-list").replaceChildren(); el("batch-more").hidden = true; selectionCount(); status(""); };
  const resume = async () => {
    const account = el("account").value; if (!account) return;
    const saved = await api.resumeRelinkDirectory(account); if (el("account").value !== account) return;
    reset(); plan = saved; if (!plan) return;
    for (const choice of plan.selections || []) selected.set(choice.assetId, choice.candidateId);
    status(`已读取本机预览：${plan.folder}。预览及选择保留 7 天，确认时重新校验，不会自动执行。`); appendRows(); selectionCount();
  };
  el("batch-choose").addEventListener("click", async () => {
    reset(); el("batch-choose").disabled = true; el("batch-cancel").hidden = false; status("正在核对目录，按大小和原文件内容匹配…");
    try {
      plan = await api.chooseRelinkDirectory(el("account").value); if (!plan) { status("已取消选择。"); return; }
      status(`${plan.folder} · ${plan.items.length} 项素材。${plan.truncated ? "已达 25000 项或 20 层目录上限，请选择更小的子目录。" : ""} ${plan.warnings.join(" ")}`); appendRows();
    } catch (error) { status(error.message); }
    finally { el("batch-choose").disabled = false; el("batch-cancel").hidden = true; }
  });
  el("batch-cancel").addEventListener("click", () => api.cancelRelinkDirectory().catch(error => status(error.message)));
  el("batch-more").addEventListener("click", appendRows);
  el("batch-apply").addEventListener("click", async () => {
    if (!plan || !selected.size || saving) return;
    el("batch-apply").disabled = true; el("batch-choose").disabled = true;
    for (const select of el("batch-list").querySelectorAll("select")) select.disabled = true;
    status("正在逐项校验并关联，请完成后退出…");
    try {
      const receipt = await api.applyRelinkDirectory(plan.id, [...selected].map(([assetId, candidateId]) => ({ assetId, candidateId })));
      status(`已关联 ${receipt.items.filter(item => item.ok).length} 项，失败 ${receipt.items.filter(item => !item.ok).length} 项。重新核对目录可重试失败项。`);
      for (const item of receipt.items.filter(item => !item.ok)) { const p = document.createElement("p"); p.textContent = `${item.assetId}：${item.error}`; el("batch-list").append(p); }
      if (receipt.items.every(item => item.ok)) { plan = null; selected.clear(); el("batch-more").hidden = true; }
    } catch (error) { status(error.message); }
    finally { el("batch-choose").disabled = false; }
  });
  el("account").addEventListener("change", reset);
  el("manage").addEventListener("click", () => { void resume().catch(error => status(error.message)); });
  el("batch-clear").addEventListener("click", async () => { try { await api.discardRelinkDirectory(el("account").value); reset(); status("保存的目录预览已清除，原文件保留。"); } catch (error) { status(error.message); } });
})();
