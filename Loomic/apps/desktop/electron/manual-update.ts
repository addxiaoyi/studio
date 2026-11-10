type Release = { version: string; platform: string; fileName: string; sha256: string };
export async function checkManualUpdate(current: string, arch: string, request: typeof fetch = fetch) {
  const platform = `macos-${arch === "arm64" ? "arm64" : "x64"}`;
  const response = await request(`https://studio.0st.top/downloads/desktop-release-${platform}.json`, { signal: AbortSignal.timeout(30000), redirect: "error", cache: "no-store" });
  if (!response.ok) throw new Error(`更新通道暂不可用（${response.status}），请稍后重试。`);
  const release = await response.json() as Release;
  if (release.platform !== platform || !/^\d+\.\d+\.\d+$/.test(release.version) || !/^Helstera-[\w.-]+\.dmg$/.test(release.fileName) || !/^[a-f0-9]{64}$/.test(release.sha256)) throw new Error("更新清单无效，请稍后重试。");
  const before = current.split(".").map(Number), after = release.version.split(".").map(Number);
  const difference = after.map((part, i) => part - (before[i] ?? 0)).find(part => part !== 0) ?? 0;
  return { status: difference > 0 ? "available" as const : "not-available" as const, reason: "manual install required" as const, version: release.version, downloadUrl: `https://studio.0st.top/downloads/${release.fileName}`, message: difference > 0 ? "发现新版本。请下载 DMG，退出 Helstera 后替换应用；本地工作区与设置保留。" : "当前已是最新版本。macOS 使用 DMG 手动替换应用。" };
}
