window.appendMediaMerge = (container, group, account, complete) => {
  const api = window.electronAPI, files = group.files.filter(file => file.relativePath.startsWith(`Media/${account}/`));
  if (files.length < 2) return;
  const section = document.createElement("section"), intro = document.createElement("p"), keeper = document.createElement("select"), options = document.createElement("div"), preview = document.createElement("button"), details = document.createElement("div"), status = document.createElement("p");
  section.className = "merge-preview"; section.setAttribute("aria-label", "重复素材合并"); status.setAttribute("role", "status");
  intro.textContent = "合并后保留原路径和素材 ID，共享同一份文件内容。直接修改共享原文件会影响全部引用；删除单个路径不会删除其他引用。";
  keeper.setAttribute("aria-label", "保留原文件"); for (const file of files) keeper.add(new Option(file.relativePath, file.id));
  preview.textContent = "核对工程引用与合并范围"; preview.disabled = true;
  const selected = new Set();
  const render = () => {
    selected.clear(); options.replaceChildren(); details.replaceChildren(); preview.disabled = true;
    for (const file of files.filter(file => file.id !== keeper.value)) {
      const label = document.createElement("label"), checkbox = document.createElement("input"), text = document.createElement("span");
      label.className = "confirm-row"; checkbox.type = "checkbox"; checkbox.setAttribute("aria-label", `合并副本 ${file.name}`); text.textContent = file.relativePath;
      checkbox.addEventListener("change", () => { if (checkbox.checked) selected.add(file.id); else selected.delete(file.id); preview.disabled = !selected.size; details.replaceChildren(); }); label.append(checkbox, text); options.append(label);
    }
  };
  const controls = disabled => { keeper.disabled = disabled; for (const input of options.querySelectorAll("input")) input.disabled = disabled; preview.disabled = disabled || !selected.size; };
  keeper.addEventListener("change", render); render();
  preview.addEventListener("click", async () => {
    controls(true); status.textContent = "正在核对文件与工程引用…";
    try {
      const plan = await api.previewMediaMerge(account, keeper.value, [...selected]); details.replaceChildren();
      const summary = document.createElement("p"), references = document.createElement("ul"), label = document.createElement("label"), accept = document.createElement("input"), text = document.createElement("span"), confirm = document.createElement("button");
      summary.textContent = `涉及 ${plan.assets} 个素材 ID、${plan.projects.length} 个工程；${plan.files.length} 个副本，文件内容合计 ${(plan.bytes / 1024 ** 2).toFixed(1)} MiB。实际释放空间由文件系统统计。`;
      for (const project of plan.projects) { const item = document.createElement("li"); item.textContent = `${project.kind === "video" ? "视频工程" : "画布工程"} · ${project.name}`; references.append(item); }
      label.className = "confirm-row"; accept.type = "checkbox"; text.textContent = "我已核对工程引用，确认共享原文件并释放选中副本的重复内容。"; label.append(accept, text);
      confirm.textContent = "确认合并并释放重复内容"; confirm.disabled = true; accept.addEventListener("change", () => { confirm.disabled = !accept.checked; });
      confirm.addEventListener("click", async () => {
        controls(true); confirm.disabled = true; accept.disabled = true; status.textContent = "正在合并，请等待完成后退出…";
        try { const receipt = await api.applyMediaMerge(plan.id, accept.checked); complete(); document.getElementById("usage-status").textContent = `已合并 ${receipt.mergedFiles} 个副本，原路径和素材 ID 保留。${receipt.errors.join(" ")} 可重新扫描核对。`; }
        catch (error) { status.textContent = error.message; details.replaceChildren(); }
        finally { controls(false); }
      });
      details.append(summary, references, label, confirm); status.textContent = "引用核对完成，等待确认。";
    } catch (error) { status.textContent = error.message; }
    finally { controls(false); }
  });
  section.append(intro, keeper, options, preview, details, status); container.append(section);
};
