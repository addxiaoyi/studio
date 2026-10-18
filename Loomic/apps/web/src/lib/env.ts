// Production requests must stay same-origin when a public API origin is not configured.
const defaultServerBaseUrl = "";

function isLoopbackHost(hostname: string) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]";
}

function isLoopbackUrl(value: string) {
  try {
    return isLoopbackHost(new URL(value).hostname);
  } catch {
    return false;
  }
}

export function isLocalAuth() {
  return true;
}

export function getServerBaseUrl() {
  // Must access process.env.NEXT_PUBLIC_* directly — webpack DefinePlugin
  // only replaces direct references, not indirect access via a variable.
  const configuredUrl = process.env.NEXT_PUBLIC_SERVER_BASE_URL?.trim();
  if (typeof window !== "undefined" && isLoopbackHost(window.location.hostname) && !configuredUrl) {
    return "http://localhost:3001";
  }
  if (typeof window !== "undefined" && !isLoopbackHost(window.location.hostname)) {
    if (!configuredUrl || isLoopbackUrl(configuredUrl)) return "";
  }
  return configuredUrl || defaultServerBaseUrl;
}

export function getServerPreconnectUrl() {
  const configuredUrl = process.env.NEXT_PUBLIC_SERVER_BASE_URL?.trim();
  return configuredUrl && !isLoopbackUrl(configuredUrl) ? configuredUrl : null;
}

export type WebEnv = {
  serverBaseUrl: string;
};

export function loadWebEnv(overrides: Partial<WebEnv> = {}): WebEnv {
  return {
    serverBaseUrl: overrides.serverBaseUrl ?? getServerBaseUrl(),
  };
}
