import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  desktopExtensionKindSchema,
  desktopMarketplaceExtensionInputSchema,
  desktopMarketplaceExtensionSchema,
  type DesktopMarketplaceExtension,
  type DesktopMarketplaceExtensionInput,
} from "@helstera/shared";

const MAX_REGISTRY_BYTES = 512_000;
const MAX_MANIFEST_BYTES = 64_000;
const SAFE_TOOL_NAME = /^[a-z][a-z0-9_]{0,79}$/;

type StoredExtension = DesktopMarketplaceExtension;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>) {
  return Object.keys(value).every((key) => allowed.has(key));
}

function containsCredentialField(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsCredentialField);
  if (!isRecord(value)) return false;
  return Object.entries(value).some(([key, child]) =>
    /token|secret|password|authorization|headers?|api[_-]?key|environment|^env$/i.test(key)
    || containsCredentialField(child),
  );
}

function safeHttpsUrl(value: unknown) {
  if (typeof value !== "string" || value.length > 2_000) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.hash;
  } catch {
    return false;
  }
}

function safeRequiredConfig(value: unknown) {
  if (value === undefined) return true;
  if (!Array.isArray(value) || value.length > 12) return false;
  return value.every((field) => {
    if (!isRecord(field)) return false;
    return typeof field.envName === "string"
      && /^[A-Z_][A-Z0-9_]{0,79}$/.test(field.envName)
      && typeof field.label === "string"
      && field.label.length <= 120
      && ["text", "secret", "directory"].includes(String(field.kind))
      && typeof field.required === "boolean"
      && typeof field.sensitive === "boolean";
  });
}

function validateManifest(input: DesktopMarketplaceExtensionInput) {
  if (!safeHttpsUrl(input.sourceUrl)) return "Marketplace sources must use HTTPS.";
  if ((input.kind === "mcp" && input.target !== "desktop") || (input.kind !== "mcp" && input.target !== "workspace")) {
    return "This extension type cannot use the requested install target.";
  }
  if (Buffer.byteLength(JSON.stringify(input.manifest), "utf8") > MAX_MANIFEST_BYTES) {
    return "The extension manifest is too large.";
  }
  if (containsCredentialField(input.manifest)) {
    return "Credentials must stay in encrypted local storage.";
  }

  const manifest = input.manifest;
  if (input.kind === "mcp") {
    if (!hasOnlyKeys(manifest, new Set(["transport", "command", "args", "url", "requiredConfig"]))) {
      return "The MCP manifest contains unsupported fields.";
    }
    if (!safeRequiredConfig(manifest.requiredConfig)) return "The MCP configuration schema is invalid.";
    if (manifest.transport === "stdio") {
      if (manifest.command !== "npx") return "Only reviewed npm MCP launchers can run on this device.";
      if (!Array.isArray(manifest.args) || manifest.args.length < 2 || manifest.args.length > 32) {
        return "The MCP launcher arguments are invalid.";
      }
      if (manifest.args.some((arg) => typeof arg !== "string" || arg.length > 4_096 || /[\0\r\n]/.test(arg))) {
        return "The MCP launcher arguments contain unsupported characters.";
      }
    } else if (manifest.transport === "http") {
      if (!safeHttpsUrl(manifest.url)) return "Remote MCP endpoints must use HTTPS.";
    } else {
      return "The MCP transport is not supported.";
    }
  }

  if (input.kind === "skill") {
    if (!hasOnlyKeys(manifest, new Set(["source", "path", "readmeUrl"]))) {
      return "The Skill manifest contains unsupported fields.";
    }
    if (manifest.source !== undefined && typeof manifest.source !== "string") return "The Skill source is invalid.";
    if (manifest.path !== undefined && typeof manifest.path !== "string") return "The Skill path is invalid.";
    if (manifest.readmeUrl !== undefined && !safeHttpsUrl(manifest.readmeUrl)) return "The Skill documentation URL is invalid.";
  }

  if (input.kind === "plugin") {
    if (!hasOnlyKeys(manifest, new Set(["module", "agentInstructions", "toolAllowlist", "downloadUrl", "downloadName", "sha256", "platforms"]))) {
      return "The Plugin manifest contains unsupported fields.";
    }
    if (manifest.module !== undefined && manifest.module !== "declarative-agent-guidance") {
      return "Only declarative Agent plugins can run from the marketplace.";
    }
    if (typeof manifest.agentInstructions !== "string" || !manifest.agentInstructions.trim() || manifest.agentInstructions.length > 8_000) {
      return "The Plugin must provide declarative Agent instructions.";
    }
    if (!Array.isArray(manifest.toolAllowlist) || manifest.toolAllowlist.length > 32 || manifest.toolAllowlist.some((tool) => typeof tool !== "string" || !SAFE_TOOL_NAME.test(tool))) {
      return "The Plugin tool allowlist is invalid.";
    }
    if (manifest.downloadUrl !== undefined && !safeHttpsUrl(manifest.downloadUrl)) return "Plugin downloads must use HTTPS.";
    if (manifest.sha256 !== undefined && (typeof manifest.sha256 !== "string" || !/^[a-f0-9]{64}$/i.test(manifest.sha256))) return "The Plugin checksum is invalid.";
    if (manifest.platforms !== undefined && (!Array.isArray(manifest.platforms) || manifest.platforms.some((platform) => typeof platform !== "string" || platform.length > 32))) return "The Plugin platform list is invalid.";
  }

  return null;
}

function statusFor(input: DesktopMarketplaceExtensionInput, enabled: boolean, blocked: boolean): DesktopMarketplaceExtension["status"] {
  if (blocked) return "blocked";
  if (!enabled) return "disabled";
  if (input.kind === "mcp" && !input.localServerId) return "missing";
  if (input.kind === "mcp" && input.localConnected === false) return "disconnected";
  return "enabled";
}

export class DesktopExtensionRegistry {
  constructor(private readonly configPath: string) {}

  async list(): Promise<DesktopMarketplaceExtension[]> {
    return this.read();
  }

  async reconcile(inputs: DesktopMarketplaceExtensionInput[]): Promise<DesktopMarketplaceExtension[]> {
    const previous = new Map((await this.read()).map((extension) => [extension.itemId, extension]));
    const next: StoredExtension[] = [];
    const now = new Date().toISOString();
    const seen = new Set<string>();

    for (const raw of inputs) {
      const parsed = desktopMarketplaceExtensionInputSchema.safeParse(raw);
      if (!parsed.success || seen.has(parsed.data.itemId)) continue;
      seen.add(parsed.data.itemId);
      const input = parsed.data;
      const reason = validateManifest(input);
      const old = previous.get(input.itemId);
      const enabled = reason
        ? false
        : old?.enabled
          ?? (typeof input.metadata.enabled === "boolean" ? input.metadata.enabled : true);
      next.push({
        ...input,
        enabled,
        status: statusFor(input, enabled, Boolean(reason)),
        ...(reason ? { statusMessage: reason } : {}),
        installedAt: old?.installedAt ?? now,
        updatedAt: now,
      });
    }

    await this.write(next);
    return next;
  }

  async setEnabled(itemId: string, enabled: boolean): Promise<DesktopMarketplaceExtension[]> {
    const extensions = await this.read();
    const extension = extensions.find((entry) => entry.itemId === itemId);
    if (!extension) throw new Error("The desktop extension is not installed.");
    if (extension.status === "blocked") throw new Error(`This extension is blocked by the desktop safety policy. ${extension.statusMessage ?? ""}`.trim());
    extension.enabled = enabled;
    extension.status = enabled
      ? extension.kind === "mcp" && !extension.localServerId
        ? "missing"
        : extension.kind === "mcp" && extension.localConnected === false
          ? "disconnected"
          : "enabled"
      : "disabled";
    extension.updatedAt = new Date().toISOString();
    await this.write(extensions);
    return extensions;
  }

  async setConnection(itemId: string, connected: boolean): Promise<DesktopMarketplaceExtension[]> {
    const extensions = await this.read();
    const extension = extensions.find((entry) => entry.itemId === itemId);
    if (!extension) return extensions;
    extension.localConnected = connected;
    if (extension.enabled && extension.status !== "blocked") extension.status = connected ? "enabled" : "disconnected";
    extension.updatedAt = new Date().toISOString();
    await this.write(extensions);
    return extensions;
  }

  async setLocalServerState(
    itemId: string,
    state: { exists: boolean; serverId?: string; connected: boolean },
  ): Promise<DesktopMarketplaceExtension[]> {
    const extensions = await this.read();
    const extension = extensions.find((entry) => entry.itemId === itemId && entry.kind === "mcp");
    if (!extension) return extensions;

    const nextServerId = state.exists ? state.serverId : undefined;
    const nextStatus: DesktopMarketplaceExtension["status"] = extension.status === "blocked"
      ? "blocked"
      : !extension.enabled
        ? "disabled"
        : !state.exists
          ? "missing"
          : state.connected
            ? "enabled"
            : "disconnected";
    const unchanged = extension.localServerId === nextServerId
      && extension.localConnected === (state.exists ? state.connected : false)
      && extension.status === nextStatus;
    if (unchanged) return extensions;

    if (nextServerId) extension.localServerId = nextServerId;
    else delete extension.localServerId;
    extension.localConnected = state.exists ? state.connected : false;
    extension.status = nextStatus;
    extension.updatedAt = new Date().toISOString();
    await this.write(extensions);
    return extensions;
  }

  private async read(): Promise<DesktopMarketplaceExtension[]> {
    try {
      const raw = await readFile(this.configPath);
      if (raw.byteLength > MAX_REGISTRY_BYTES) throw new Error("Desktop extension registry exceeds its size limit.");
      const parsed: unknown = JSON.parse(raw.toString("utf8"));
      if (!Array.isArray(parsed)) throw new Error("Desktop extension registry is invalid.");
      const valid = parsed.flatMap((entry) => {
        const result = desktopMarketplaceExtensionSchema.safeParse(entry);
        return result.success ? [result.data] : [];
      });
      return valid;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }

  private async write(extensions: DesktopMarketplaceExtension[]) {
    await mkdir(dirname(this.configPath), { recursive: true });
    const temporaryPath = `${this.configPath}.${randomUUID()}.tmp`;
    await writeFile(temporaryPath, JSON.stringify(extensions), { mode: 0o600, flag: "wx" });
    await rename(temporaryPath, this.configPath);
  }
}
