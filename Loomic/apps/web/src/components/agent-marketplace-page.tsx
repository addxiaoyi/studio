"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import {
  Accessibility,
  BookOpen,
  Brain,
  Camera,
  Cable,
  ChevronDown,
  ChevronUp,
  Cloud,
  Code2,
  Database,
  Download,
  ExternalLink,
  FileText,
  Film,
  FolderOpen,
  FolderTree,
  GitBranch,
  Globe2,
  Languages,
  Lightbulb,
  LoaderCircle,
  MapPinned,
  Megaphone,
  MessageCircle,
  MousePointerClick,
  Notebook,
  Palette,
  PanelsTopLeft,
  PackageCheck,
  PackageOpen,
  Puzzle,
  Rocket,
  Scissors,
  Search,
  SearchX,
  ShieldCheck,
  Sparkles,
  Terminal,
  TestTubeDiagonal,
  Trash2,
  Workflow,
  X,
  type LucideIcon,
} from "lucide-react";
import { DesktopEmptyState } from "@/components/desktop-empty-state";
import { useDesktopToast } from "@/components/desktop-toast";
import { useAuth } from "@/lib/auth-context";
import {
  fetchAgentMarketplaceInstalls,
  installMarketplaceSkill,
  removeAgentMarketplaceInstall,
  syncAgentMarketplaceInstall,
  uninstallSkill,
  type AgentMarketplaceInstall,
} from "@/lib/server-api";
import { getServerBaseUrl } from "@/lib/env";
import {
  formatDesktopCopy,
  useDesktopCopy,
  type DesktopCopy,
  type DesktopLocale,
} from "@/lib/desktop-copy";
import { buildDesktopMarketplaceInstallUrl } from "@/lib/desktop-marketplace-link";

type Kind = "all" | "skill" | "mcp" | "plugin";
type Entry = {
  id: string; kind: Exclude<Kind, "all">; name: string; slug: string; description: string;
  source_url: string; version: string; license: string | null; manifest: Record<string, unknown>;
};
type RequiredConfig = { envName: string; label: string; kind: "text" | "secret" | "directory"; required: boolean; sensitive: boolean };
type LocalMcpServer = { id: string; name: string };
type DesktopMcpApi = {
  getMcpServers: () => Promise<LocalMcpServer[]>;
  selectDirectory: (title?: string) => Promise<string | null>;
  installMarketplaceMcp: (input: { name: string; command: string; args: string[]; requiredConfig: RequiredConfig[]; config: Record<string, string> }) => Promise<{ id: string; servers: LocalMcpServer[] }>;
  removeMcpServer: (id: string) => Promise<LocalMcpServer[]>;
  getPendingMarketplaceInstall: () => Promise<string | null>;
  acknowledgeMarketplaceInstall: (slug: string) => Promise<{ ok: boolean }>;
  onMarketplaceInstallRequested: (callback: (slug: string) => void) => () => void;
};
type Tab = "discover" | "installed";

const filters: Array<{ value: Kind }> = [
  { value: "all" }, { value: "skill" }, { value: "mcp" }, { value: "plugin" },
];

const kindIcons = {
  skill: BookOpen,
  mcp: Cable,
  plugin: Puzzle,
} satisfies Record<Entry["kind"], LucideIcon>;

const iconRules: Array<[RegExp, LucideIcon]> = [
  [/accessibility|a11y/, Accessibility],
  [/playwright|puppeteer|browser|chrome/, Globe2],
  [/filesystem|asset-librarian/, FolderTree],
  [/memory|knowledge/, Brain],
  [/thinking|goal/, Lightbulb],
  [/postgres|redis|database/, Database],
  [/brave|search|seo|firecrawl/, Search],
  [/maps|map/, MapPinned],
  [/slack|meeting|support/, MessageCircle],
  [/github|gitlab|release-notes/, GitBranch],
  [/aws|cloudflare|browserbase/, Cloud],
  [/notion|docs|notebook|research/, Notebook],
  [/code|cli|aspnet|jupyter/, Code2],
  [/figma|design|photo/, Palette],
  [/video|storyboard|short-video/, Film],
  [/campaign|social/, Megaphone],
  [/localization|language/, Languages],
  [/website|landing/, PanelsTopLeft],
  [/product-photo|camera/, Camera],
  [/qa|test|ci/, TestTubeDiagonal],
  [/brand/, Sparkles],
  [/workflow|automation/, Workflow],
  [/desktop|mouse/, MousePointerClick],
  [/launch|deploy/, Rocket],
  [/video-edit|editing/, Scissors],
  [/copy|document|writer/, FileText],
  [/shield|security/, ShieldCheck],
  [/terminal/, Terminal],
];

function descriptionForEntry(entry: Entry, copy: DesktopCopy) {
  return copy.marketplace.catalog[entry.slug]?.description ?? entry.description;
}

function configLabel(field: RequiredConfig, copy: DesktopCopy) {
  return copy.marketplace.configLabels[field.envName] ?? field.label;
}

function iconForEntry(entry: Entry): LucideIcon {
  return iconRules.find(([pattern]) => pattern.test(entry.slug))?.[1] ?? kindIcons[entry.kind];
}

function detailForEntry(entry: Entry, copy: DesktopCopy): { heading: string; body: string } | null {
  const detail = copy.marketplace.detail;
  if (entry.kind === "plugin" && typeof entry.manifest.agentInstructions === "string") {
    return { heading: detail.agentGuide, body: copy.marketplace.catalog[entry.slug]?.details ?? entry.manifest.agentInstructions };
  }
  if (entry.kind === "mcp") {
    const fields = Array.isArray(entry.manifest.requiredConfig)
      ? entry.manifest.requiredConfig as RequiredConfig[]
      : [];
    const configSummary = fields.length
      ? fields.map((field) => configLabel(field, copy) + (field.sensitive ? detail.sensitive : "")).join(copy.marketplace.configSeparator)
      : detail.noConfig;
    return { heading: detail.mcpHeading, body: formatDesktopCopy(detail.mcpTransport, { summary: configSummary }) };
  }
  const path = typeof entry.manifest.path === "string" ? entry.manifest.path : null;
  const readmeUrl = typeof entry.manifest.readmeUrl === "string" ? entry.manifest.readmeUrl : null;
  if (path || readmeUrl) {
    return { heading: detail.skillHeading, body: [path ? formatDesktopCopy(detail.skillFile, { path }) : "", readmeUrl ? formatDesktopCopy(detail.readme, { url: readmeUrl }) : ""].filter(Boolean).join("\n") };
  }
  return { heading: detail.installLocation, body: copy.marketplace.kind[entry.kind].target };
}

function messageOf(error: unknown, copy: DesktopCopy) {
  return error instanceof Error ? error.message : copy.marketplace.operationFailed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseMarketplaceEntries(value: unknown, copy: DesktopCopy): Entry[] {
  if (!Array.isArray(value)) throw new Error(copy.marketplace.invalidMarketData);
  return value.map((item) => {
    if (!isRecord(item)
      || !["skill", "mcp", "plugin"].includes(String(item.kind))
      || typeof item.id !== "string"
      || typeof item.name !== "string"
      || typeof item.slug !== "string"
      || typeof item.description !== "string"
      || typeof item.source_url !== "string"
      || typeof item.version !== "string"
      || (item.license !== null && typeof item.license !== "string")) {
      throw new Error(copy.marketplace.invalidEntryData);
    }
    return {
      id: item.id,
      kind: item.kind as Entry["kind"],
      name: item.name,
      slug: item.slug,
      description: item.description,
      source_url: item.source_url,
      version: item.version,
      license: item.license,
      manifest: isRecord(item.manifest) ? item.manifest : {},
    };
  });
}

function parseMarketplaceInstalls(value: unknown, copy: DesktopCopy): AgentMarketplaceInstall[] {
  if (!Array.isArray(value) || !value.every((item) =>
    isRecord(item)
      && typeof item.item_id === "string"
      && ["workspace", "desktop"].includes(String(item.target))
      && typeof item.installed_version === "string"
      && item.status === "installed"
      && isRecord(item.metadata)
      && ["skill", "mcp", "plugin"].includes(String(item.kind))
      && typeof item.name === "string"
      && typeof item.slug === "string")) {
    throw new Error(copy.marketplace.invalidInstalls);
  }
  return value as AgentMarketplaceInstall[];
}

/**
 * #88: the server now reports `available:false` for installs whose catalog listing was taken
 * down. Responses from older servers do not carry the flag at all, so only an explicit
 * `false` counts as delisted.
 */
function isInstallAvailable(install: AgentMarketplaceInstall): boolean {
  return (install as AgentMarketplaceInstall & { available?: unknown }).available !== false;
}

/** #89: the marketplace publishes a plugin's SHA-256 inside its manifest. */
function checksumFor(entry: Entry): { full: string; short: string } | null {
  const value = entry.manifest.sha256;
  if (typeof value !== "string") return null;
  const full = value.trim();
  if (!full) return null;
  return { full, short: full.slice(0, 12) };
}

const EMPTY_STATE_ACTION_CLASS =
  "rounded-md border border-border/60 px-3 py-1.5 text-xs font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/**
 * Three different "nothing here" cases that used to share one flat sentence:
 * a search that matched nothing, a workspace with no installs yet, and a market
 * that really is empty. They need different copy because the user action differs.
 */
function MarketplaceEmptyState({ tab, loggedOut, hasQuery, onClearFilters, onBrowse, copy }: {
  tab: Tab;
  loggedOut: boolean;
  hasQuery: boolean;
  onClearFilters: () => void;
  onBrowse: () => void;
  copy: DesktopCopy;
}) {
  const empty = copy.marketplace.empty;
  if (hasQuery) {
    return <DesktopEmptyState
      icon={SearchX}
      title={empty.noMatchTitle}
      description={empty.noMatchBody}
      action={<button type="button" className={EMPTY_STATE_ACTION_CLASS} onClick={onClearFilters}>{empty.clearFilters}</button>}
    />;
  }
  if (tab === "installed") {
    return <DesktopEmptyState
      icon={PackageOpen}
      title={empty.installedTitle}
      description={empty.installedBody}
      action={<button type="button" className={EMPTY_STATE_ACTION_CLASS} onClick={onBrowse}>{empty.browse}</button>}
    />;
  }
  if (loggedOut) {
    return <DesktopEmptyState
      icon={PackageOpen}
      title={empty.loggedOutTitle}
      description={empty.loggedOutBody}
    />;
  }
  return <DesktopEmptyState
    icon={PackageOpen}
    title={empty.catalogEmptyTitle}
    description={empty.catalogEmptyBody}
  />;
}

export function AgentMarketplacePage({ locale }: { locale?: DesktopLocale | null } = {}) {
  const { copy } = useDesktopCopy(locale);
  const { session } = useAuth();
  const toast = useDesktopToast();
  const [kind, setKind] = useState<Kind>("all");
  const [tab, setTab] = useState<Tab>("discover");
  const [query, setQuery] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [installs, setInstalls] = useState<AgentMarketplaceInstall[]>([]);
  const [localServers, setLocalServers] = useState<LocalMcpServer[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [desktopLaunchSlug, setDesktopLaunchSlug] = useState<string | null>(null);
  const [pendingDesktopInstallSlug, setPendingDesktopInstallSlug] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [setupItem, setSetupItem] = useState<Entry | null>(null);
  const [config, setConfig] = useState<Record<string, string>>({});

  const desktopApi = typeof window === "undefined"
    ? undefined
    : (window as Window & { electronAPI?: DesktopMcpApi }).electronAPI;

  const load = useCallback(async () => {
    if (!session?.access_token) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const headers = { Authorization: "Bearer " + session.access_token };
      const [marketResponse, installed] = await Promise.all([
        fetch(getServerBaseUrl() + "/api/agent-marketplace", { headers }),
        fetchAgentMarketplaceInstalls(session.access_token),
      ]);
      if (!marketResponse.ok) throw new Error(marketResponse.status === 404 ? copy.marketplace.marketDisabled : copy.marketplace.loadFailed);
      const payload = await marketResponse.json() as { data?: unknown };
      setEntries(parseMarketplaceEntries(payload?.data, copy));
      setInstalls(parseMarketplaceInstalls(installed, copy));
    } catch (cause) {
      setError(messageOf(cause, copy));
    } finally {
      setLoading(false);
    }
  }, [copy, session?.access_token]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (desktopApi) void desktopApi.getMcpServers().then(setLocalServers).catch(() => setLocalServers([]));
  }, [desktopApi]);

  useEffect(() => {
    if (!desktopApi) return;
    const unsubscribe = desktopApi.onMarketplaceInstallRequested(setPendingDesktopInstallSlug);
    void desktopApi.getPendingMarketplaceInstall().then((slug) => {
      if (slug) setPendingDesktopInstallSlug(slug);
    }).catch((cause) => setError(messageOf(cause, copy)));
    return unsubscribe;
  }, [desktopApi]);

  const installedIds = useMemo(() => new Set(installs.map((item) => item.item_id)), [installs]);
  const delistedInstalls = useMemo(() => installs.filter((item) => !isInstallAvailable(item)), [installs]);
  const visible = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return entries.filter((entry) => {
      if (kind !== "all" && entry.kind !== kind) return false;
      if (tab === "installed" && !installedIds.has(entry.id)) return false;
      if (normalizedQuery && ![entry.name, entry.slug, descriptionForEntry(entry, copy), entry.description]
        .some((value) => value.toLocaleLowerCase().includes(normalizedQuery))) return false;
      return true;
    });
  }, [copy, entries, installedIds, kind, query, tab]);
  const counts = useMemo(() => ({
    all: entries.length,
    skill: entries.filter((entry) => entry.kind === "skill").length,
    mcp: entries.filter((entry) => entry.kind === "mcp").length,
    plugin: entries.filter((entry) => entry.kind === "plugin").length,
  }), [entries]);

  useEffect(() => {
    if (!desktopApi || !pendingDesktopInstallSlug || loading || !session?.access_token) return;
    let canceled = false;
    const slug = pendingDesktopInstallSlug;
    void (async () => {
      const entry = entries.find((candidate) => candidate.slug === slug && candidate.kind === "mcp");
      if (!entry) {
        setError(copy.marketplace.mcpMissing);
        await desktopApi.acknowledgeMarketplaceInstall(slug);
        if (!canceled) setPendingDesktopInstallSlug(null);
        return;
      }
      const servers = await desktopApi.getMcpServers();
      if (canceled) return;
      setLocalServers(servers);
      const installedLocally = servers.some((server) => server.name === entry.name);
      let shouldRefresh = false;
      if (installedLocally) {
        if (!session?.access_token) throw new Error(copy.marketplace.loginForSync);
        await syncAgentMarketplaceInstall(session.access_token, entry.id, {
          target: "desktop", localInstalled: true, localServerName: entry.name,
        });
        setNotice(formatDesktopCopy(copy.marketplace.installedLocallySynced, { name: entry.name }));
        shouldRefresh = true;
      } else {
        const fields = Array.isArray(entry.manifest.requiredConfig) ? entry.manifest.requiredConfig as RequiredConfig[] : [];
        setConfig(Object.fromEntries(fields.map((field) => [field.envName, ""])));
        setSetupItem(entry);
        setNotice(copy.marketplace.desktopInstallRequested);
      }
      await desktopApi.acknowledgeMarketplaceInstall(slug);
      if (!canceled) {
        setPendingDesktopInstallSlug(null);
        if (shouldRefresh && session?.access_token) {
          void fetchAgentMarketplaceInstalls(session.access_token)
            .then(setInstalls)
            .catch((cause) => setError(messageOf(cause, copy)));
        }
      }
    })().catch((cause: unknown) => {
      if (!canceled) setError(messageOf(cause, copy));
    });
    return () => { canceled = true; };
  }, [copy, desktopApi, entries, loading, pendingDesktopInstallSlug, session?.access_token]);

  async function installWorkspaceEntry(entry: Entry) {
    if (busyId) return;
    if (!session?.access_token) {
      setError(copy.marketplace.loginForInstall);
      toast.push({
        tone: "error",
        message: formatDesktopCopy(copy.marketplace.installFailToast, {
          name: entry.name,
          reason: copy.marketplace.loginForInstall,
        }),
      });
      return;
    }
    setBusyId(entry.id);
    setError(null);
    try {
      if (entry.kind === "skill") {
        const response = await installMarketplaceSkill(session.access_token, entry.source_url);
        await syncAgentMarketplaceInstall(session.access_token, entry.id, { target: "workspace", skillId: response.skill.id });
      } else {
        await syncAgentMarketplaceInstall(session.access_token, entry.id, { target: "workspace" });
      }
      setNotice(formatDesktopCopy(copy.marketplace.installNotice, { name: entry.name }));
      toast.push({ tone: "success", message: formatDesktopCopy(copy.marketplace.installedToast, { name: entry.name }), key: "install:" + entry.id });
      window.dispatchEvent(new Event("desktop:marketplace-install-changed"));
      await load();
    } catch (cause) {
      setError(messageOf(cause, copy));
      toast.push({ tone: "error", message: formatDesktopCopy(copy.marketplace.installFailToast, { name: entry.name, reason: messageOf(cause, copy) }) });
    } finally {
      setBusyId(null);
    }
  }

  async function syncLocalMcpInstall(entry: Entry) {
    if (busyId) return;
    if (!session?.access_token) {
      setError(copy.marketplace.loginForSyncState);
      toast.push({
        tone: "error",
        message: formatDesktopCopy(copy.marketplace.syncFailToast, {
          name: entry.name,
          reason: copy.marketplace.loginForSyncToast,
        }),
      });
      return;
    }
    const local = localServers.find((server) => server.name === entry.name);
    if (!local) {
      setError(copy.marketplace.localMcpMissing);
      toast.push({
        tone: "error",
        message: formatDesktopCopy(copy.marketplace.syncFailToast, {
          name: entry.name,
          reason: copy.marketplace.localMcpMissingReason,
        }),
      });
      return;
    }
    setBusyId(entry.id);
    setError(null);
    try {
      await syncAgentMarketplaceInstall(session.access_token, entry.id, {
        target: "desktop", localInstalled: true, localServerName: entry.name,
      });
      setNotice(formatDesktopCopy(copy.marketplace.syncedLocal, { name: entry.name }));
      toast.push({ tone: "success", message: formatDesktopCopy(copy.marketplace.installedToast, { name: entry.name }), key: "install:" + entry.id });
      window.dispatchEvent(new Event("desktop:marketplace-install-changed"));
      await load();
    } catch (cause) {
      setError(messageOf(cause, copy));
      toast.push({ tone: "error", message: formatDesktopCopy(copy.marketplace.syncFailToast, { name: entry.name, reason: messageOf(cause, copy) }) });
    } finally {
      setBusyId(null);
    }
  }

  function beginInstall(entry: Entry) {
    setError(null);
    setNotice(null);
    if (entry.kind !== "mcp") {
      void installWorkspaceEntry(entry);
      return;
    }
    if (!desktopApi) {
      setDesktopLaunchSlug(entry.slug);
      setNotice(formatDesktopCopy(copy.marketplace.openingDesktop, { name: entry.name }));
      window.location.assign(buildDesktopMarketplaceInstallUrl(entry.slug));
      return;
    }
    if (entry.manifest.transport !== "stdio" || entry.manifest.command !== "npx"
      || !Array.isArray(entry.manifest.args)
      || entry.manifest.args.some((arg) => typeof arg !== "string")) {
      setError(copy.marketplace.unreviewedConfig);
      return;
    }
    if (localServers.some((server) => server.name === entry.name)) {
      void syncLocalMcpInstall(entry);
      return;
    }
    const fields = Array.isArray(entry.manifest.requiredConfig) ? entry.manifest.requiredConfig as RequiredConfig[] : [];
    setConfig(Object.fromEntries(fields.map((field) => [field.envName, ""])));
    setSetupItem(entry);
  }

  async function submitMcpInstall(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!setupItem || busyId) return;
    const item = setupItem;
    if (!session?.access_token) {
      setError(copy.marketplace.loginForInstall);
      toast.push({
        tone: "error",
        message: formatDesktopCopy(copy.marketplace.installFailToast, {
          name: item.name,
          reason: copy.marketplace.loginForInstall,
        }),
      });
      return;
    }
    if (!desktopApi) {
      setError(copy.marketplace.desktopMissing);
      toast.push({
        tone: "error",
        message: formatDesktopCopy(copy.marketplace.installFailToast, {
          name: item.name,
          reason: copy.marketplace.desktopMissingReason,
        }),
      });
      return;
    }
    const fields = Array.isArray(item.manifest.requiredConfig) ? item.manifest.requiredConfig as RequiredConfig[] : [];
    const missing = fields.find((field) => field.required && !config[field.envName]?.trim());
    if (missing) {
      setError(formatDesktopCopy(copy.marketplace.fieldRequired, { label: configLabel(missing, copy) }));
      return;
    }
    const args = item.manifest.args as string[];
    const command = ["npx", ...args].join(" ");
    if (!window.confirm(formatDesktopCopy(copy.marketplace.installConfirm, {
      name: setupItem.name,
      command,
      source: setupItem.source_url,
    }))) return;

    setBusyId(item.id);
    setError(null);
    try {
      await desktopApi.installMarketplaceMcp({ name: item.name, command: "npx", args, requiredConfig: fields, config });
      setLocalServers(await desktopApi.getMcpServers());
      await syncAgentMarketplaceInstall(session.access_token, item.id, {
        target: "desktop", localInstalled: true, localServerName: item.name,
      });
      setNotice(formatDesktopCopy(copy.marketplace.installedAndConnected, { name: item.name }));
      toast.push({ tone: "success", message: formatDesktopCopy(copy.marketplace.installedToast, { name: item.name }), key: "install:" + item.id });
      window.dispatchEvent(new Event("desktop:marketplace-install-changed"));
      setSetupItem(null);
      setConfig({});
      await load();
    } catch (cause) {
      setError(messageOf(cause, copy));
      toast.push({ tone: "error", message: formatDesktopCopy(copy.marketplace.installFailToast, { name: item.name, reason: messageOf(cause, copy) }) });
    } finally {
      setBusyId(null);
    }
  }

  async function pickDirectory(field: RequiredConfig) {
    if (!desktopApi) return;
    try {
      const path = await desktopApi.selectDirectory(field.label);
      if (path) setConfig((current) => ({ ...current, [field.envName]: path }));
    } catch (cause) {
      setError(messageOf(cause, copy));
    }
  }

  async function releaseLocalInstall(install: AgentMarketplaceInstall, accessToken: string) {
    if (install.kind === "skill") {
      const skillId = install.metadata.skillId;
      if (typeof skillId === "string") await uninstallSkill(accessToken, skillId);
      return;
    }
    if (install.kind !== "mcp") return;
    if (!desktopApi) throw new Error(copy.marketplace.desktopRemoveRequired);
    const server = localServers.find((item) => item.name === install.name);
    if (!server) return;
    await desktopApi.removeMcpServer(server.id);
    setLocalServers(await desktopApi.getMcpServers());
  }

  async function uninstall(entry: Entry) {
    if (busyId) return;
    if (!session?.access_token) {
      setError(copy.marketplace.loginForUninstall);
      toast.push({
        tone: "error",
        message: formatDesktopCopy(copy.marketplace.uninstallFailToast, {
          name: entry.name,
          reason: copy.marketplace.loginForUninstall,
        }),
      });
      return;
    }
    const install = installs.find((item) => item.item_id === entry.id);
    if (!install) {
      setError(copy.marketplace.installRecordMissing);
      toast.push({
        tone: "error",
        message: formatDesktopCopy(copy.marketplace.uninstallFailToast, {
          name: entry.name,
          reason: copy.marketplace.installRecordMissingReason,
        }),
      });
      return;
    }
    if (!window.confirm(formatDesktopCopy(copy.marketplace.uninstallConfirm, {
      scope: install.target === "desktop" ? copy.marketplace.scopeDevice : copy.marketplace.scopeWorkspace,
      name: entry.name,
    }))) return;
    setBusyId(entry.id);
    setError(null);
    try {
      await releaseLocalInstall(install, session.access_token);
      await removeAgentMarketplaceInstall(session.access_token, entry.id);
      setNotice(formatDesktopCopy(copy.marketplace.uninstalled, { name: entry.name }));
      toast.push({ tone: "success", message: formatDesktopCopy(copy.marketplace.uninstalledToast, { name: entry.name }), key: "uninstall:" + entry.id });
      window.dispatchEvent(new Event("desktop:marketplace-install-changed"));
      await load();
    } catch (cause) {
      setError(messageOf(cause, copy));
      toast.push({ tone: "error", message: formatDesktopCopy(copy.marketplace.uninstallFailToast, { name: entry.name, reason: messageOf(cause, copy) }) });
    } finally {
      setBusyId(null);
    }
  }

  async function removeDelistedInstall(install: AgentMarketplaceInstall) {
    if (busyId) return;
    if (!session?.access_token) {
      setError(copy.marketplace.loginForRemove);
      toast.push({
        tone: "error",
        message: formatDesktopCopy(copy.marketplace.removeFailToast, {
          name: install.name,
          reason: copy.marketplace.loginForRemove,
        }),
      });
      return;
    }
    if (!window.confirm(formatDesktopCopy(copy.marketplace.removeDelistedConfirm, { name: install.name }))) return;
    setBusyId(install.item_id);
    setError(null);
    try {
      await releaseLocalInstall(install, session.access_token);
      await removeAgentMarketplaceInstall(session.access_token, install.item_id);
      setNotice(formatDesktopCopy(copy.marketplace.removed, { name: install.name }));
      toast.push({ tone: "success", message: formatDesktopCopy(copy.marketplace.removedToast, { name: install.name }), key: "remove:" + install.item_id });
      window.dispatchEvent(new Event("desktop:marketplace-install-changed"));
      await load();
    } catch (cause) {
      setError(messageOf(cause, copy));
      toast.push({ tone: "error", message: formatDesktopCopy(copy.marketplace.removeFailToast, { name: install.name, reason: messageOf(cause, copy) }) });
    } finally {
      setBusyId(null);
    }
  }

  async function copyChecksum(entry: Entry, full: string) {
    try {
      const clipboard = typeof navigator === "undefined" ? undefined : navigator.clipboard;
      if (!clipboard?.writeText) throw new Error("Clipboard API unavailable");
      await clipboard.writeText(full);
      setNotice(formatDesktopCopy(copy.marketplace.checksumCopied, { name: entry.name }));
    } catch {
      setError(formatDesktopCopy(copy.marketplace.clipboardFailed, { hash: full }));
    }
  }

  return (
    <main className="agent-marketplace">
      <header className="agent-marketplace__header">
        <div className="agent-marketplace__heading">
          <div className="agent-marketplace__heading-mark"><Puzzle aria-hidden="true" /></div>
          <div><p>HELSTERA / AGENT MARKETPLACE</p><h1>{copy.marketplace.headerTitle}</h1><span>{copy.marketplace.headerSubtitle}</span></div>
        </div>
        <div className="agent-marketplace__catalog-count" aria-label={copy.marketplace.catalogCountAria}>
          <strong>{counts.skill + counts.mcp + counts.plugin}</strong><span>{copy.marketplace.catalogCountSuffix}</span>
        </div>
      </header>
      <div className="agent-marketplace__toolbar">
        <div className="agent-marketplace__filters" role="tablist" aria-label={copy.marketplace.viewAria}>
          <button type="button" role="tab" aria-selected={tab === "discover"} onClick={() => setTab("discover")}>{copy.marketplace.tabDiscover}</button>
          <button type="button" role="tab" aria-selected={tab === "installed"} onClick={() => setTab("installed")}>{formatDesktopCopy(copy.marketplace.tabInstalled, { count: installs.length })}</button>
        </div>
        <div className="agent-marketplace__filters" role="group" aria-label={copy.marketplace.kindsAria}>
          {filters.map((item) => <button key={item.value} type="button" aria-pressed={kind === item.value} onClick={() => setKind(item.value)}>{copy.marketplace.filters[item.value]}<span className="ml-1 text-[10px] text-muted-foreground">{counts[item.value]}</span></button>)}
        </div>
        <label><Search aria-hidden="true"/><input aria-label={copy.marketplace.searchAria} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={copy.marketplace.searchPlaceholder}/></label>
      </div>
      {error ? <p className="agent-marketplace__error" role="alert">{error}</p> : null}
      {notice ? <p className="agent-marketplace__notice" role="status">{notice}{desktopLaunchSlug ? <a href="/download/" className="agent-marketplace__download-desktop">{copy.marketplace.downloadDesktop}</a> : null}</p> : null}
      {loading ? <p className="agent-marketplace__state"><LoaderCircle className="animate-spin"/>{copy.marketplace.loading}</p>
        : visible.length === 0 && !(tab === "installed" && delistedInstalls.length > 0) ? <MarketplaceEmptyState
          tab={tab}
          loggedOut={!session?.access_token}
          hasQuery={query.trim().length > 0}
          onClearFilters={() => { setQuery(""); setKind("all"); }}
          onBrowse={() => setTab("discover")}
          copy={copy}
        />
          : <section className="agent-marketplace__list" aria-label={copy.marketplace.listAria}>
            {visible.map((entry) => {
              const installed = installedIds.has(entry.id);
              const itemBusy = busyId === entry.id;
              const category = copy.marketplace.kind[entry.kind];
              const CategoryIcon = kindIcons[entry.kind];
              const EntryIcon = iconForEntry(entry);
              const details = detailForEntry(entry, copy);
              const checksum = checksumFor(entry);
              const detailsOpen = expandedId === entry.id;
              return <article key={entry.id} className={`agent-marketplace__card is-${entry.kind}`}>
                <div className="agent-marketplace__card-top">
                  <div className={`agent-marketplace__icon is-${entry.kind}`}><EntryIcon aria-hidden="true" /></div>
                  <div className="agent-marketplace__title">
                    <span className={`agent-marketplace__kind is-${entry.kind}`}><CategoryIcon aria-hidden="true" />{category.label}</span>
                    <h2>{entry.name}</h2>
                  </div>
                  {installed ? <span className="agent-marketplace__installed"><PackageCheck aria-hidden="true"/>{copy.marketplace.installedBadge}</span> : null}
                </div>
                <p className="agent-marketplace__description">{descriptionForEntry(entry, copy)}</p>
                <div className="agent-marketplace__meta">
                  <span>v{entry.version}</span>
                  {entry.license ? <span>{entry.license}</span> : null}
                  <span>{category.target}</span>
                  {checksum
                    ? <span className="agent-marketplace__checksum">
                      <code title={checksum.full}>SHA-256 {checksum.short}</code>
                      <button type="button" className="agent-marketplace__checksum-copy" aria-label={formatDesktopCopy(copy.marketplace.checksumCopyAria, { name: entry.name })} onClick={() => void copyChecksum(entry, checksum.full)}>{copy.marketplace.checksumCopy}</button>
                    </span>
                    : <span className="agent-marketplace__checksum is-missing">{copy.marketplace.checksumMissing}</span>}
                </div>
                {detailsOpen && details ? <section className="agent-marketplace__details" aria-label={formatDesktopCopy(copy.marketplace.detailsAria, { name: entry.name })}>
                  <h3>{details.heading}</h3>
                  <p>{details.body}</p>
                  {entry.kind === "plugin" ? <small>{copy.marketplace.pluginNote}</small> : null}
                  {entry.kind === "mcp" && Array.isArray(entry.manifest.requiredConfig) && entry.manifest.requiredConfig.length > 0
                    ? <small>{copy.marketplace.mcpSecretNote}</small> : null}
                </section> : null}
                <footer className="agent-marketplace__card-actions">
                  <div>
                    <a href={entry.source_url} target="_blank" rel="noreferrer">{copy.marketplace.source} <ExternalLink aria-hidden="true"/></a>
                    <button type="button" className="agent-marketplace__details-toggle" aria-expanded={detailsOpen} onClick={() => setExpandedId(detailsOpen ? null : entry.id)}>
                      {detailsOpen ? copy.marketplace.collapse : copy.marketplace.expand}{detailsOpen ? <ChevronUp aria-hidden="true"/> : <ChevronDown aria-hidden="true"/>}
                    </button>
                  </div>
                  {installed
                    ? <button type="button" className="agent-marketplace__install is-installed" disabled={itemBusy} onClick={() => void uninstall(entry)}>{itemBusy ? <LoaderCircle className="animate-spin"/> : <Trash2/>}{copy.marketplace.uninstall}</button>
                    : <button type="button" className="agent-marketplace__install" disabled={itemBusy} onClick={() => beginInstall(entry)}>{itemBusy ? <LoaderCircle className="animate-spin"/> : <Download/>}{copy.marketplace.install}</button>}
                </footer>
              </article>;
            })}
          </section>}

      {!loading && tab === "installed" && delistedInstalls.length > 0 ? <section className="agent-marketplace__list" aria-label={copy.marketplace.delistedAria}>
        {delistedInstalls.map((install) => {
          const itemBusy = busyId === install.item_id;
          return <article key={install.item_id + ":" + install.target} className="agent-marketplace__card is-delisted">
            <div className="agent-marketplace__card-top">
              <div className="agent-marketplace__icon is-plugin"><Puzzle aria-hidden="true" /></div>
              <div className="agent-marketplace__title">
                <span className="agent-marketplace__kind is-plugin"><PackageCheck aria-hidden="true" />{copy.marketplace.delistedBadge}</span>
                <h2>{install.name}</h2>
              </div>
            </div>
            <p className="agent-marketplace__description" role="status">{copy.marketplace.delistedBody}</p>
            <div className="agent-marketplace__meta">
              <span>v{install.installed_version}</span>
              <span>{install.target === "desktop" ? copy.marketplace.scopeDevice : copy.marketplace.scopeWorkspace}</span>
            </div>
            <footer className="agent-marketplace__card-actions">
              <div><span className="agent-marketplace__delisted-hint">{copy.marketplace.delistedHint}</span></div>
              <button type="button" className="agent-marketplace__install is-installed" disabled={itemBusy} onClick={() => void removeDelistedInstall(install)}>{itemBusy ? <LoaderCircle className="animate-spin"/> : <Trash2/>}{copy.marketplace.remove}</button>
            </footer>
          </article>;
        })}
      </section> : null}

      {setupItem ? <div className="agent-market-admin__overlay" role="presentation">
        <form onSubmit={(event) => void submitMcpInstall(event)} aria-labelledby="market-mcp-setup-title">
          <header><div><h2 id="market-mcp-setup-title">{formatDesktopCopy(copy.marketplace.setupTitle, { name: setupItem.name })}</h2><p>{copy.marketplace.setupSubtitle}</p></div><button type="button" aria-label={copy.marketplace.setupClose} onClick={() => setSetupItem(null)}><X aria-hidden="true"/></button></header>
          {(Array.isArray(setupItem.manifest.requiredConfig) ? setupItem.manifest.requiredConfig as RequiredConfig[] : []).map((field) => (
            <label key={field.envName}><span>{configLabel(field, copy)}{field.required ? " *" : ""}</span>
              <div className="flex min-w-0 gap-2">
                <input type={field.kind === "secret" ? "password" : "text"} autoComplete="off" readOnly={field.kind === "directory"} required={field.required} value={config[field.envName] ?? ""} onChange={(event) => setConfig((current) => ({ ...current, [field.envName]: event.target.value }))}/>
                {field.kind === "directory" ? <button type="button" aria-label={copy.marketplace.setupPickDirectory} onClick={() => void pickDirectory(field)}><FolderOpen aria-hidden="true"/></button> : null}
              </div>
            </label>
          ))}
          {error ? <p role="alert" className="agent-marketplace__error">{error}</p> : null}
          <button type="submit" disabled={busyId === setupItem.id}>{busyId === setupItem.id ? <LoaderCircle className="animate-spin"/> : <PackageCheck/>}{copy.marketplace.setupSubmit}</button>
        </form>
      </div> : null}
    </main>
  );
}
