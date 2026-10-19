export function getSafeRedirect(value: string | null | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/home";
  return value;
}

export function loginPath(currentPath: string): string {
  return `/login?redirect=${encodeURIComponent(currentPath || "/home")}`;
}
