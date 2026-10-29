const DESKTOP_AUTH_SCHEME = "helstera:";

export function parseMarketplaceInstallSlug(value: string): string | null {
  let url: URL;
  try { url = new URL(value); } catch { return null; }
  if (url.protocol !== DESKTOP_AUTH_SCHEME || url.hostname !== "marketplace" || url.pathname !== "/install" || url.port || url.username || url.password || url.hash) return null;
  const params = [...url.searchParams.entries()];
  if (params.length !== 1 || params[0]?.[0] !== "slug") return null;
  const slug = params[0][1];
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) && slug.length <= 100 ? slug : null;
}
