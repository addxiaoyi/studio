export function buildDesktopMarketplaceInstallUrl(slug: string): string {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 100) throw new Error("市场条目标识无效，无法打开桌面安装请求。");
  const url = new URL("helstera://marketplace/install");
  url.searchParams.set("slug", slug);
  return url.toString();
}
