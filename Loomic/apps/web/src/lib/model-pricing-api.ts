import type { OfficialModelPriceCatalog, WorkspaceModelPrice } from "@helstera/shared";
import { getServerBaseUrl } from "./env";

export async function fetchOfficialModelPrices(): Promise<OfficialModelPriceCatalog> {
  const response = await fetch(`${getServerBaseUrl()}/api/public/model-prices`, {
    credentials: "include",
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Official model prices unavailable (${response.status})`);
  const payload = await response.json() as { ok: true; data: OfficialModelPriceCatalog };
  return payload.data;
}

export async function fetchWorkspaceModelPrices(): Promise<{ authenticated: boolean; models: WorkspaceModelPrice[] }> {
  const response = await fetch(`${getServerBaseUrl()}/api/workspace/model-prices`, {
    credentials: "include",
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Workspace model prices unavailable (${response.status})`);
  const payload = await response.json() as { ok: true; data: { authenticated: boolean; models: WorkspaceModelPrice[] } };
  return payload.data;
}
