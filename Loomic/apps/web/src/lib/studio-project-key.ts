export function studioProjectKey(userId: string, address: string): string {
  const query = new URL(address, "https://helstera.invalid").searchParams;
  const id =
    query.get("timelineCanvas") ??
    query.get("returnCanvas") ??
    query.get("project");
  return id && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(id)
    ? `${userId}:canvas:${id}`
    : userId;
}

export function rememberStudioProject(userId: string, address: string): string {
  const explicit = studioProjectKey(userId, address),
    key = `helstera:studio-active:${userId}`;
  const isComposition = new URL(address).search.startsWith("?/");
  try {
    const previous = sessionStorage.getItem(key);
    if (
      explicit === userId &&
      isComposition &&
      previous?.startsWith(`${userId}:canvas:`)
    )
      return previous;
    sessionStorage.setItem(key, explicit);
  } catch (cause) {
    console.warn(
      "[studio] current project could not be retained across reload",
      cause,
    );
  }
  return explicit;
}
