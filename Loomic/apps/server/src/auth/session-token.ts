export function readSessionToken(
  authorization: string | string[] | undefined,
  cookie: string | undefined,
): string | null {
  const cookieToken = cookie?.match(/(?:^|;\s*)helstera_session=([^;]+)/)?.[1];
  if (cookieToken) return cookieToken;
  if (typeof authorization !== "string") return null;
  const [scheme, token] = authorization.trim().split(/\s+/, 2);
  return scheme?.toLowerCase() === "bearer" && token ? token : null;
}
