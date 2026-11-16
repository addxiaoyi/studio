export function getSafeRedirect(value: string | null | undefined): string {
  if (
    !value ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\") ||
    [...value].some(
      (character) =>
        character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    )
  )
    return "/home";
  try {
    const origin = "https://workspace.invalid";
    const target = new URL(value, origin);
    if (target.origin !== origin || target.pathname.startsWith("//"))
      return "/home";
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return "/home";
  }
}

export function loginPath(currentPath: string): string {
  return `/login?redirect=${encodeURIComponent(currentPath || "/home")}`;
}
export function workspaceHomePath(): string {
  return typeof document !== "undefined" &&
    document.documentElement.dataset.helsteraDesktop === "true"
    ? "/desktop-app/"
    : "/home/";
}
