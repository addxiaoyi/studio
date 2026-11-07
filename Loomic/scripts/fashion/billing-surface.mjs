export function connectFashionBilling(shell, host) {
  const select = shell.querySelector("#aiModel");
  const summary = window.document.createElement("section");
  summary.className = "fashion-model-summary";
  summary.setAttribute("aria-label", "模型与计费");
  select.closest(".ai-model-row").after(summary);
  const refresh = window.document.createElement("button");
  refresh.type = "button";
  refresh.className = "fashion-refresh-models";
  refresh.textContent = "刷新模型与价格";
  summary.after(refresh);
  const status = window.document.createElement("output");
  status.className = "fashion-task-status";
  status.setAttribute("aria-live", "polite");
  shell.querySelector("#aiGenerate").before(status);
  let catalog = host.models,
    loading = false;
  function render() {
    const personal = select.disabled;
    const model = catalog.find((item) => item.id === select.value);
    summary.replaceChildren();
    const title = window.document.createElement("strong");
    title.textContent = personal
      ? "个人模型 / 本机服务"
      : (model?.displayName ?? "请选择可用模型");
    const price = window.document.createElement("p");
    price.textContent = personal
      ? "平台不收生成积分；第三方服务费用按你的配置结算。"
      : model
        ? `${model.priceLabel} · 参考价格`
        : "暂无可用平台模型";
    const note = window.document.createElement("p");
    note.className = "fashion-model-note";
    note.textContent = personal
      ? "执行前确认发送目标与模型。"
      : model
        ? `${model.resolution} · 竖屏 2:3 · 人物与服装两张参考图。${model.reason || "以本次审批中的精确积分为准。"}`
        : "刷新目录或在管理配置中选择个人后端。";
    summary.append(title, price, note);
    const button = shell.querySelector("#aiGenerate");
    if (button.dataset.generating !== "true")
      button.disabled = loading || (!personal && !model?.available);
  }
  function updateModels(models) {
    const current = select.value;
    catalog = models;
    select.replaceChildren(
      ...models.map((model) => {
        const option = window.document.createElement("option");
        option.value = model.id;
        option.textContent = model.displayName;
        option.disabled = !model.available;
        return option;
      }),
    );
    if (!models.length) {
      const empty = window.document.createElement("option");
      empty.value = "";
      empty.textContent = "暂无可用图像模型";
      select.append(empty);
    }
    select.value = models.some(
      (model) => model.id === current && model.available,
    )
      ? current
      : (models.find((model) => model.available)?.id ?? "");
    select.dispatchEvent(new Event("change", { bubbles: true }));
    render();
  }
  refresh.addEventListener("click", async () => {
    if (loading) return;
    loading = true;
    refresh.disabled = true;
    refresh.textContent = "正在刷新…";
    render();
    try {
      updateModels(await host.refreshModels());
      status.textContent = "模型和参考价格已更新。";
    } catch (error) {
      status.textContent = error.message || "模型刷新失败，请重试。";
    } finally {
      loading = false;
      refresh.disabled = false;
      refresh.textContent = "刷新模型与价格";
      render();
    }
  });
  select.addEventListener("change", render);
  const observer = new MutationObserver(render);
  observer.observe(select, { attributes: true, attributeFilter: ["disabled"] });
  updateModels(catalog);
  return {
    updateModels,
    updateModelsState: render,
    setStatus(message) {
      status.textContent = message;
    },
    dispose() {
      observer.disconnect();
      select.removeEventListener("change", render);
    },
  };
}
