import type { BrowserContext } from "playwright";

export async function closeCaptureContext(context: BrowserContext, requests: AbortController) {
  requests.abort();
  // Routed response bodies live outside Chromium; closing a page does not cancel them.
  await context.unrouteAll({ behavior: "ignoreErrors" });
  await context.close();
}
