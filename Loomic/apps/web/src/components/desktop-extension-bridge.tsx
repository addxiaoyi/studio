"use client";

import { useEffect, useRef } from "react";

import { fetchAgentMarketplaceInstalls } from "@/lib/server-api";
import { getServerBaseUrl } from "@/lib/env";

type DesktopExtensionApi = {
  getMcpServers?: () => Promise<Array<{ id: string; name: string; connected: boolean }>>;
  syncDesktopExtensions?: (input: DesktopExtensionSyncInput[]) => Promise<unknown>;
};

type DesktopExtensionSyncInput = {
  itemId: string;
  slug: string;
  name: string;
  kind: "skill" | "mcp" | "plugin";
  target: "workspace" | "desktop";
  version: string;
  description: string;
  sourceUrl: string;
  manifest: Record<string, unknown>;
  metadata: Record<string, unknown>;
  localServerId?: string;
  localConnected?: boolean;
};

function desktopApi() {
  return typeof window === "undefined"
    ? undefined
    : (window as Window & { electronAPI?: DesktopExtensionApi }).electronAPI;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isInstalled(value: unknown): value is Record<string, unknown> {
  return isRecord(value)
    && value.status === "installed"
    && typeof value.item_id === "string"
    && (value.target === "workspace" || value.target === "desktop")
    && typeof value.installed_version === "string"
    && isRecord(value.metadata)
    && value.available !== false;
}

export function DesktopExtensionBridge({ accessToken }: { accessToken: string }) {
  const lastToken = useRef<string | null>(null);

  useEffect(() => {
    const api = desktopApi();
    const syncDesktopExtensions = api?.syncDesktopExtensions;
    const getMcpServers = api?.getMcpServers;
    if (!syncDesktopExtensions || !getMcpServers || !accessToken || lastToken.current === accessToken) return;
    lastToken.current = accessToken;
    let canceled = false;

    const sync = async () => {
      const [catalogResponse, installs, localServers] = await Promise.all([
        fetch(getServerBaseUrl() + "/api/agent-marketplace", {
          headers: { Authorization: "Bearer " + accessToken },
        }),
        fetchAgentMarketplaceInstalls(accessToken),
        getMcpServers(),
      ]);
      if (!catalogResponse.ok) throw new Error("The desktop extension catalog is unavailable.");
      const payload = await catalogResponse.json() as { data?: unknown };
      if (!Array.isArray(payload.data)) throw new Error("The desktop extension catalog response is invalid.");
      const catalog = new Map(
        payload.data
          .filter(isRecord)
          .filter((entry) => typeof entry.id === "string" && ["skill", "mcp", "plugin"].includes(String(entry.kind)) && typeof entry.name === "string" && typeof entry.slug === "string" && typeof entry.description === "string" && typeof entry.source_url === "string" && typeof entry.version === "string")
          .map((entry) => [String(entry.id), entry]),
      );
      const syncInput = installs
        .filter(isInstalled)
        .flatMap((install) => {
          const entry = catalog.get(String(install.item_id));
          if (!entry) return [];
          const localName = typeof install.metadata.localServerName === "string" ? install.metadata.localServerName : null;
          const local = localName ? localServers.find((server) => server.name === localName) : undefined;
          return [{
            itemId: String(entry.id),
            slug: String(entry.slug),
            name: String(entry.name),
            kind: entry.kind as "skill" | "mcp" | "plugin",
            target: install.target as "workspace" | "desktop",
            version: String(entry.version),
            description: String(entry.description),
            sourceUrl: String(entry.source_url),
            manifest: isRecord(entry.manifest) ? entry.manifest : {},
            metadata: install.metadata,
            ...(local ? { localServerId: local.id, localConnected: local.connected } : {}),
          } satisfies DesktopExtensionSyncInput];
        });
      if (!canceled) await syncDesktopExtensions(syncInput);
    };
    const syncAfterInstall = () => {
      void sync().catch((error) => {
        if (!canceled) console.warn("[desktop-extensions] catalog sync failed", error);
      });
    };
    window.addEventListener("desktop:marketplace-install-changed", syncAfterInstall);
    void sync().catch((error) => {
      if (!canceled) console.warn("[desktop-extensions] catalog sync failed", error);
    });

    return () => {
      canceled = true;
      window.removeEventListener("desktop:marketplace-install-changed", syncAfterInstall);
    };
  }, [accessToken]);

  return null;
}
