import { websiteCapturePairingSchema } from "@helstera/shared";

const PAIRING_SOCKET_PATH = "/api/website-capture/assistant/ws";
const PAIRING_PAGE_PATH = "/desktop-browser-pair.html";
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function buildBrowserPairingUrl(input: unknown, desktopWebsiteUrl: string): string {
  const pairing = websiteCapturePairingSchema.parse(input);
  if (!pairing.code) throw new Error("配对码缺失，请重新发起连接。");

  const site = new URL(desktopWebsiteUrl);
  const socket = new URL(pairing.wssUrl);
  const isLocalSite = site.protocol === "http:" && LOCAL_HOSTS.has(site.hostname);
  const hasValidProtocol = isLocalSite ? socket.protocol === "ws:" : socket.protocol === "wss:";
  const sharesTrustedHost = socket.hostname === site.hostname;

  if (
    !hasValidProtocol
    || !sharesTrustedHost
    || socket.username
    || socket.password
    || socket.search
    || socket.hash
    || socket.pathname !== PAIRING_SOCKET_PATH
  ) {
    throw new Error("浏览器配对地址与 Helstera 站点不匹配。");
  }

  const target = new URL(PAIRING_PAGE_PATH, site);
  target.hash = new URLSearchParams({ code: pairing.code, wssUrl: socket.toString() }).toString();
  return target.toString();
}
