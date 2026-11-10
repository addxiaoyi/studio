// Keep the pinned workflow's IDs while integrating its overlays into the host.
export function connectFashionSurface(shell, host) {
  const dialogs = [
    ["modal", "mclose", "class"],
    ["aiSettings", "settingsCancel", "hidden"],
    ["aiHistory", "aiHistoryClose", "hidden"],
    ["aiServiceDialog", "aiServiceDialogCancel", "hidden"],
    ["taobaoGuide", "taobaoGuideClose", "hidden"],
  ];
  const cleanups = [];
  for (const [id, closeId, attribute] of dialogs) {
    const previous = shell.querySelector(`#${id}`);
    const dialog = window.document.createElement("dialog");
    for (const { name, value } of previous.attributes) dialog.setAttribute(name, value);
    dialog.append(...previous.childNodes);
    previous.replaceWith(dialog);
    if (id === "modal") dialog.querySelector(".mbox").prepend(dialog.querySelector("#mclose"));
    const observer = new MutationObserver(() => {
      const visible = attribute === "class" ? dialog.classList.contains("open") : !dialog.hidden;
      if (visible && !dialog.open) dialog.showModal();
      if (!visible && dialog.open) dialog.close();
    });
    observer.observe(dialog, { attributes: true, attributeFilter: [attribute] });
    dialog.addEventListener("cancel", event => {
      event.preventDefault();
      shell.querySelector(`#${closeId}`).click();
    });
    dialog.addEventListener("keydown", event => {
      if (event.key !== "Tab") return;
      const controls = [...dialog.querySelectorAll('button, [href], input, select, textarea, [tabindex]')]
        .filter(control => control.tabIndex >= 0 && !control.matches(":disabled") && control.getClientRects().length);
      const active = shell.getRootNode().activeElement;
      if (event.shiftKey && active === controls[0]) {
        event.preventDefault();
        controls.at(-1)?.focus();
      } else if (!event.shiftKey && active === controls.at(-1)) {
        event.preventDefault();
        controls[0]?.focus();
      }
    });
    cleanups.push(() => { observer.disconnect(); if (dialog.open) dialog.close(); });
  }

  const fitting = shell.querySelector("#fitting");
  fitting.setAttribute("role", "region");
  fitting.removeAttribute("aria-modal");
  let fittingOpen = false;
  let fittingTrigger = null;
  const fittingObserver = new MutationObserver(() => {
    const open = fitting.classList.contains("open");
    if (open === fittingOpen) return;
    fittingOpen = open;
    if (open) {
      fittingTrigger = shell.getRootNode().activeElement;
      shell.querySelector("#fitBack").focus();
    } else {
      (fittingTrigger?.isConnected ? fittingTrigger : shell.querySelector("#fittingToggle")).focus();
    }
    // The original modal locked its document; this view now scrolls with the host.
    shell.style.removeProperty("overflow");
  });
  fittingObserver.observe(fitting, { attributes: true, attributeFilter: ["class"] });
  cleanups.push(() => fittingObserver.disconnect());

  for (const [id, inputId] of [["fitUpload", "fitFile"], ["fitGarmentUpload", "fitGarmentFile"]]) {
    const upload = shell.querySelector(`#${id}`);
    upload.tabIndex = 0;
    upload.setAttribute("role", "button");
    upload.addEventListener("keydown", event => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      shell.querySelector(`#${inputId}`).click();
    });
    const choose = window.document.createElement("button");
    choose.type = "button"; choose.className = "fit-library-button";
    choose.textContent = inputId === "fitFile" ? "从素材库选择人物照片" : "从素材库选择服装";
    choose.addEventListener("click", async () => {
      if (choose.disabled) return;
      choose.disabled = true;
      try {
        const file = await host.chooseImage(inputId === "fitFile" ? "person" : "garment");
        if (!file || !shell.isConnected) return;
        const transfer = new DataTransfer(); transfer.items.add(file);
        const input = shell.querySelector(`#${inputId}`);
        input.files = transfer.files; input.dispatchEvent(new Event("change", {bubbles:true}));
      } catch (cause) {
        let notice = choose.nextElementSibling;
        if (!notice?.classList.contains("fit-library-error")) {notice=window.document.createElement("p");notice.className="fit-library-error";notice.setAttribute("role","alert");choose.after(notice);}
        notice.textContent = cause instanceof Error ? cause.message : "素材导入失败。";
      }
      finally { choose.disabled = false; }
    });
    upload.insertAdjacentElement("afterend", choose);
  }
  shell.querySelector("#fitSearch").setAttribute("aria-label", "搜索服装");
  shell.querySelector("#aiModel").setAttribute("aria-label", "换装模型");
  shell.querySelector("#aiResultImg").alt = "试穿生成结果";
  shell.querySelector("#fitPhotoPreview").alt = "人物照片预览";
  shell.querySelector("#count").setAttribute("role", "status");
  shell.querySelector("#grid").setAttribute("role", "tabpanel");
  shell.querySelector("#grid").setAttribute("aria-label", "服装图集");

  const categories = shell.querySelector("#tabs");
  categories.addEventListener("keydown", event => {
    const tabs = [...categories.querySelectorAll("button")];
    const current = tabs.indexOf(event.target);
    if (current < 0) return;
    let index;
    if (event.key === "ArrowRight") index = (current + 1) % tabs.length;
    else if (event.key === "ArrowLeft") index = (current + tabs.length - 1) % tabs.length;
    else if (event.key === "Home") index = 0;
    else if (event.key === "End") index = tabs.length - 1;
    else return;
    event.preventDefault();
    tabs[index].click();
    categories.querySelector('[aria-selected="true"]').focus();
  });
  return () => {
    for (const dispose of cleanups) dispose();
  };
}
