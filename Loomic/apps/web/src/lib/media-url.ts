const FALLBACK_ORIGIN = "https://helstera.invalid";

type QueryValue = string | number | boolean | null | undefined;

export function appendMediaQuery(
  input: string,
  query: Record<string, QueryValue>,
): string {
  const url = new URL(input, FALLBACK_ORIGIN);

  for (const [key, value] of Object.entries(query)) {
    if (value === null) {
      url.searchParams.delete(key);
      continue;
    }
    if (value !== undefined) url.searchParams.set(key, String(value));
  }

  const hasOrigin = /^[a-z][a-z\d+.-]*:/i.test(input) || input.startsWith("//");
  return hasOrigin ? url.toString() : `${url.pathname}${url.search}${url.hash}`;
}

export function buildMediaPreviewUrl(input: string): string {
  return appendMediaQuery(input, { preview: "1", download: null });
}

export function buildMediaDownloadUrl(input: string): string {
  return appendMediaQuery(input, { preview: null, download: "1" });
}
