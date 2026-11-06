export async function lockStudio(userId: string): Promise<() => void> {
  if (!navigator.locks) throw new Error("当前浏览器不支持安全的工程锁，请使用新版 Chrome 或桌面客户端。");
  let release = () => {};
  const held = new Promise<void>(resolve => { release = resolve; });
  await new Promise<void>((resolve, reject) => {
    void navigator.locks.request("loomic-visualforge:" + userId, { ifAvailable: true }, async lock => {
      if (!lock) { reject(new Error("此工程已在另一个标签页打开。请先关闭原编辑器，再点击“重新打开编辑器”继续。")); return; }
      resolve();
      await held;
    }).catch(reject);
  });
  return release;
}

export function studioImportName(name: string, existing: Iterable<string>): string {
  const names = new Set([...existing].map(path => path.toLowerCase()));
  const safe = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-").trim() || "素材";
  const dot = safe.lastIndexOf(".");
  const base = dot > 0 ? safe.slice(0, dot) : safe;
  const extension = dot > 0 ? safe.slice(dot) : "";
  let next = safe;
  for (let index = 2; names.has(next.toLowerCase()); index += 1) next = `${base}-${index}${extension}`;
  return next;
}
