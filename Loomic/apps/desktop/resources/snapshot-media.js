window.showSnapshotMedia = (items, context) => {
  const list = document.getElementById("media-list"), preview = document.getElementById("media-preview"), api = window.electronAPI;
  window.stopSnapshotMedia?.(); list.replaceChildren(); preview.replaceChildren();
  let active = true, visible = 0;
  const observers = [];
  window.stopSnapshotMedia = () => { active = false; for (const observer of observers) observer.disconnect(); };
  const errorText = error => error.message.replace(/^Error invoking remote method '[^']+': Error: /, "");
  const add = item => {
    const card = document.createElement("article"), open = document.createElement("button"), cover = document.createElement("div"), title = document.createElement("span"), state = document.createElement("p"), thumbnailState = document.createElement("p");
    card.className = "media-card"; cover.className = "media-cover"; cover.textContent = "正在准备本地封面…"; title.textContent = `预览 ${item.name}`;
    open.setAttribute("aria-label", `预览 ${item.name}`); open.append(cover, title); card.append(open, thumbnailState, state);
    let loadingCover = false;
    const thumbnail = async () => {
      if (loadingCover) return; loadingCover = true;
      try { const file = await api.getSnapshotThumbnail(context.id, context.account, item.assetId); if (!active) return; const image = document.createElement("img"); image.src = file.url; image.alt = "本地素材缩略图"; cover.replaceChildren(image); thumbnailState.textContent = ""; }
      catch (error) { if (active) { cover.textContent = "封面不可用"; thumbnailState.textContent = errorText(error); } }
      finally { loadingCover = false; }
    };
    const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) { observer.disconnect(); void thumbnail(); } }, { rootMargin: "80px" });
    observer.observe(card); observers.push(observer);
    open.addEventListener("click", async () => {
      open.disabled = true; preview.textContent = "正在校验本地原文件…";
      try {
        const file = await api.previewSnapshotMedia(context.id, context.account, item.assetId); if (!active) return;
        const label = document.createElement("p"); label.textContent = file.name;
        const player = document.createElement(file.mime.startsWith("image/") ? "img" : file.mime.startsWith("video/") ? "video" : "audio");
        if (player.tagName === "IMG") player.alt = file.name; else { player.controls = true; player.preload = "metadata"; player.setAttribute("aria-label", file.name); }
        player.addEventListener("error", () => { if (active) preview.textContent = "本地预览失效或格式暂不支持，请重新打开原文件。"; });
        player.src = file.url; preview.replaceChildren(label, player);
      } catch (error) { if (active) preview.textContent = errorText(error); }
      finally { open.disabled = false; }
    });
    const relink = document.createElement("button"); relink.textContent = "重新关联原文件"; relink.className = "media-relink"; card.append(relink);
    relink.addEventListener("click", async () => {
      relink.disabled = true; state.textContent = "正在核对原文件…";
      try {
        const plan = await api.chooseRelinkMedia(context.account, item.assetId); if (!active || !plan) { state.textContent = ""; return; }
        const text = document.createElement("p"), confirm = document.createElement("button"), cancel = document.createElement("button");
        text.textContent = `${plan.filename} 校验一致。${plan.willCopy ? "确认后复制到当前工作区，保留原文件。" : "确认后更新位置，不复制素材。"}`; confirm.textContent = "确认关联"; cancel.textContent = "取消关联";
        state.replaceChildren(text, confirm, cancel);
        cancel.addEventListener("click", () => state.replaceChildren());
        confirm.addEventListener("click", async () => {
          confirm.disabled = true; cancel.disabled = true;
          try { const saved = await api.applyMediaRelink(plan.id); state.textContent = `${saved.filename} 已关联并通过校验。`; preview.replaceChildren(); await thumbnail(); }
          catch (error) { state.textContent = errorText(error); }
        });
      } catch (error) { state.textContent = errorText(error); }
      finally { relink.disabled = false; }
    });
    list.append(card);
  };
  const more = document.createElement("button"); more.textContent = "显示更多素材";
  const batch = () => { more.remove(); for (const item of items.slice(visible, visible + 20)) add(item); visible += 20; if (visible < items.length) list.append(more); };
  more.addEventListener("click", batch); batch();
  if (!items.length) list.textContent = "这份快照没有本地媒体引用。";
};
