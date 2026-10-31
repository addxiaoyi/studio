import { randomUUID } from "node:crypto";
import {
  appendFile,
  mkdir,
  readFile,
  rename,
  writeFile,
} from "node:fs/promises";
import { dirname } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

export type McpServerInput = {
  name: string;
  transport: "stdio" | "http";
  command?: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  url?: string;
  token?: string;
  sensitiveArgs?: boolean;
};

export type McpTool = {
  name: string;
  description?: string;
  inputSchema: {
    type: "object";
    properties?: Record<string, object>;
    required?: string[];
  };
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    openWorldHint?: boolean;
  };
};

type StoredServer = Omit<McpServerInput, "env" | "token" | "sensitiveArgs" | "args"> & {
  args?: string[];
  sensitiveArgs?: boolean;
  encryptedArgs?: string;
  id: string;
  encryptedEnv?: string;
  encryptedToken?: string;
};

type LiveServer = { client: Client; tools: McpTool[] };
type SecureStorage = {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
};

const MAX_CONFIG_BYTES = 512_000;
const MAX_ARGUMENT_BYTES = 64_000;
const MAX_RESULT_BYTES = 80_000;
const SAFE_ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const WINDOWS_SCRIPT_COMMANDS = new Set(["npx", "npm", "pnpm", "npx.cmd", "npm.cmd", "pnpm.cmd"]);

export function resolveMcpStdioLaunch(
  command: string,
  args: string[],
  platform = process.platform,
  comspec = process.env.ComSpec ?? "cmd.exe",
) {
  if (platform !== "win32" || !WINDOWS_SCRIPT_COMMANDS.has(command.toLowerCase())) {
    return { command, args };
  }
  if (args.some((argument) => /[\0\r\n%!\"]/.test(argument))) {
    throw new Error("Windows package-runner arguments contain unsupported command characters.");
  }
  const executable = command.toLowerCase().endsWith(".cmd") ? command : `${command}.cmd`;
  const commandLine = `"${[executable, ...args]
    .map((argument) => `"${argument.replace(/"/g, '""')}"`)
    .join(" ")}"`;
  return { command: comspec, args: ["/d", "/s", "/c", commandLine] };
}

export type MarketplaceMcpConfigField = {
  envName: string;
  label: string;
  kind: "text" | "secret" | "directory";
  required: boolean;
  sensitive: boolean;
};

export function resolveMarketplaceMcpConfig(
  args: string[],
  fields: MarketplaceMcpConfigField[],
  values: Record<string, unknown>,
) {
  const env: Record<string, string> = {};
  const allowedNames = new Set(fields.map((field) => field.envName));
  if (Object.keys(values).some((key) => !allowedNames.has(key))) {
    throw new Error("Marketplace MCP configuration contains an unapproved field.");
  }
  for (const field of fields) {
    if (!/^[A-Z_][A-Z0-9_]{0,79}$/.test(field.envName)) {
      throw new Error("Marketplace MCP configuration schema is invalid.");
    }
    const value = values[field.envName];
    if (field.required && (typeof value !== "string" || !value.trim())) {
      throw new Error(field.label + " is required.");
    }
    if (typeof value === "string" && value.trim()) env[field.envName] = value.trim().slice(0, 4_096);
  }
  const sensitiveNames = new Set(fields.filter((field) => field.sensitive).map((field) => field.envName));
  const resolvedArgs = args.map((argument) => argument.replace(/\{\{([A-Z_][A-Z0-9_]*)\}\}/g, (_match, name: string) => {
    if (sensitiveNames.has(name)) {
      throw new Error("Sensitive MCP configuration must be passed through encrypted local environment storage.");
    }
    const value = env[name];
    if (!value) throw new Error("Configuration for " + name + " is required.");
    return value;
  }));
  return { args: resolvedArgs, env };
}

export function validateMcpServer(input: McpServerInput) {
  if (
    typeof input.name !== "string" ||
    !input.name.trim() ||
    input.name.length > 80
  )
    throw new Error("Enter a server name up to 80 characters.");
  if (input.transport === "stdio") {
    if (
      typeof input.command !== "string" ||
      !input.command.trim() ||
      input.command.length > 512
    )
      throw new Error("A stdio server needs an executable command.");
    if (
      (input.args !== undefined && !Array.isArray(input.args)) ||
      input.args?.some(
        (argument) => typeof argument !== "string" || argument.length > 4_096,
      )
    )
      throw new Error("MCP command arguments must be strings under 4 KB each.");
    if (
      input.env &&
      (typeof input.env !== "object" ||
        Array.isArray(input.env) ||
        Object.values(input.env).some((value) => typeof value !== "string"))
    )
      throw new Error("MCP environment variables must be string values.");
    if (Buffer.byteLength(JSON.stringify(input.env ?? {}), "utf8") > 32_000)
      throw new Error("MCP environment variables exceed the 32 KB limit.");
    if (input.cwd && !input.cwd.trim())
      throw new Error("Working directory cannot be empty.");
    for (const name of Object.keys(input.env ?? {})) {
      if (!SAFE_ENV_NAME.test(name))
        throw new Error(`Invalid environment variable name: ${name}`);
    }
    return;
  }
  if (input.transport !== "http" || !input.url)
    throw new Error("Choose a supported MCP transport and endpoint.");
  if (input.url.length > 2_048 || (input.token && input.token.length > 16_384))
    throw new Error("MCP endpoint or bearer token exceeds its size limit.");
  const endpoint = new URL(input.url);
  const localHttp =
    endpoint.protocol === "http:" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(endpoint.hostname);
  if (
    (endpoint.protocol !== "https:" && !localHttp) ||
    endpoint.username ||
    endpoint.password ||
    endpoint.hash
  ) {
    throw new Error(
      "Remote MCP endpoints must use HTTPS. HTTP is allowed only for loopback development servers.",
    );
  }
}

export class McpRegistry {
  private readonly live = new Map<string, LiveServer>();

  constructor(
    private readonly configPath: string,
    private readonly storage: SecureStorage,
  ) {}

  async list() {
    const servers = await this.readServers();
    return servers.map(({ id, name, transport, command, args, cwd, url, encryptedArgs }) => ({
      id,
      name,
      transport,
      command,
      ...(encryptedArgs ? { hasSensitiveArgs: true } : args ? { args } : {}),
      cwd,
      url,
      connected: this.live.has(id),
      tools: this.live.get(id)?.tools ?? [],
    }));
  }

  async add(input: McpServerInput) {
    validateMcpServer(input);
    const servers = await this.readServers();
    const id = randomUUID();
    const stored: StoredServer = {
      id,
      name: input.name.trim(),
      transport: input.transport,
    };
    if (input.transport === "stdio") {
      const command = input.command;
      if (!command)
        throw new Error("A stdio server needs an executable command.");
      stored.command = command.trim();
      const args = input.args ?? [];
      if (input.sensitiveArgs && args.length) {
        if (!this.storage.isEncryptionAvailable()) throw new Error("This device cannot encrypt sensitive MCP launch parameters.");
        stored.encryptedArgs = this.storage.encryptString(JSON.stringify(args)).toString("base64");
        stored.sensitiveArgs = true;
      } else {
        stored.args = args;
      }
      if (input.cwd?.trim()) stored.cwd = input.cwd.trim();
    } else {
      stored.url = input.url;
    }
    if (
      (input.token || Object.keys(input.env ?? {}).length) &&
      !this.storage.isEncryptionAvailable()
    ) {
      throw new Error(
        "This device does not provide encrypted local storage; remove credentials or enable the operating-system key store.",
      );
    }
    if (input.token)
      stored.encryptedToken = this.storage
        .encryptString(input.token)
        .toString("base64");
    if (input.env && Object.keys(input.env).length)
      stored.encryptedEnv = this.storage
        .encryptString(JSON.stringify(input.env))
        .toString("base64");
    await this.writeServers([...servers, stored]);
    return { id };
  }

  async connect(id: string) {
    if (this.live.has(id)) return this.list();
    const server = (await this.readServers()).find((entry) => entry.id === id);
    if (!server) throw new Error("MCP server was not found.");
    const token = server.encryptedToken
      ? this.decrypt(server.encryptedToken)
      : undefined;
    const client = new Client(
      { name: "helstera-desktop", version: "0.2.12" },
      { capabilities: {} },
    );
    let transport: StdioClientTransport | StreamableHTTPClientTransport;
    if (server.transport === "stdio") {
      const env = server.encryptedEnv
        ? (JSON.parse(this.decrypt(server.encryptedEnv)) as Record<
            string,
            string
          >)
        : {};
      const inheritedNames =
        process.platform === "win32"
          ? [
              "PATH",
              "PATHEXT",
              "SystemRoot",
              "WINDIR",
              "COMSPEC",
              "USERPROFILE",
              "APPDATA",
              "LOCALAPPDATA",
              "TEMP",
              "TMP",
            ]
          : ["PATH", "HOME", "LANG", "TMPDIR"];
      const inherited = Object.fromEntries(
        inheritedNames.flatMap((name) => {
          const value = process.env[name];
          return value ? [[name, value]] : [];
        }),
      );
      if (!server.command)
        throw new Error("The configured stdio executable is missing.");
      const launch = resolveMcpStdioLaunch(server.command, server.args ?? []);
      transport = new StdioClientTransport({
        command: launch.command,
        args: launch.args,
        cwd: server.cwd,
        env: { ...inherited, ...env },
        stderr: "pipe",
      });
    } else {
      if (!server.url)
        throw new Error("The configured MCP endpoint is missing.");
      const headers = token ? { Authorization: `Bearer ${token}` } : undefined;
      transport = new StreamableHTTPClientTransport(new URL(server.url), {
        requestInit: headers ? { headers } : undefined,
        redirectPolicy: "same-origin",
      });
    }
    try {
      await client.connect(transport);
      const tools = (await client.listTools()).tools as McpTool[];
      this.live.set(id, { client, tools });
      await this.audit(server.name, "connect", "ok");
      return this.list();
    } catch (error) {
      await client.close().catch(() => undefined);
      await this.audit(server.name, "connect", "failed");
      throw new Error(
        `Could not connect to ${server.name}: ${error instanceof Error ? error.message : "connection failed"}`,
      );
    }
  }

  async connectAll(skipIds: ReadonlySet<string> = new Set()) {
    const servers = await this.readServers();
    const failures: Array<{ id: string; name: string; message: string }> = [];
    for (const server of servers) {
      if (skipIds.has(server.id)) continue;
      if (this.live.has(server.id)) continue;
      try {
        await this.connect(server.id);
      } catch (error) {
        failures.push({
          id: server.id,
          name: server.name,
          message: error instanceof Error ? error.message : "MCP connection failed.",
        });
      }
    }
    return { servers: await this.list(), failures };
  }

  async disconnect(id: string) {
    const active = this.live.get(id);
    if (!active) return this.list();
    this.live.delete(id);
    await active.client.close();
    const server = (await this.readServers()).find((entry) => entry.id === id);
    if (server) await this.audit(server.name, "disconnect", "ok");
    return this.list();
  }

  async remove(id: string) {
    await this.disconnect(id);
    await this.writeServers(
      (await this.readServers()).filter((entry) => entry.id !== id),
    );
    return this.list();
  }

  async call(
    id: string,
    name: string,
    rawArguments: string,
    signal?: AbortSignal,
  ) {
    if (Buffer.byteLength(rawArguments, "utf8") > MAX_ARGUMENT_BYTES)
      throw new Error("Tool arguments exceed the 64 KB limit.");
    let args: unknown;
    try {
      args = JSON.parse(rawArguments || "{}");
    } catch {
      throw new Error("Tool arguments must be valid JSON.");
    }
    if (!args || typeof args !== "object" || Array.isArray(args))
      throw new Error("Tool arguments must be a JSON object.");
    const active = this.live.get(id);
    if (!active)
      throw new Error("Connect this MCP server before calling its tools.");
    const tool = active.tools.find((entry) => entry.name === name);
    if (!tool)
      throw new Error("This tool is not in the connected server's tool list.");
    const server = (await this.readServers()).find((entry) => entry.id === id);
    if (!server) throw new Error("MCP server was not found.");
    await this.audit(server.name, name, "started");
    try {
      const response = await active.client.callTool(
        {
          name,
          arguments: args as Record<string, unknown>,
        },
        undefined,
        {
          timeout: 60_000,
          maxTotalTimeout: 120_000,
          ...(signal ? { signal } : {}),
        },
      );
      const content: Array<Record<string, string>> = [];
      let resultBytes = 0;
      let truncated = false;
      const rawResponse: unknown = response;
      if (!rawResponse || typeof rawResponse !== "object" || !("content" in rawResponse) || !Array.isArray(rawResponse.content)) {
        throw new Error("MCP server returned an unsupported task result instead of tool content.");
      }
      for (const block of rawResponse.content as unknown[]) {
        if (!block || typeof block !== "object" || !("type" in block) || typeof block.type !== "string") continue;
        if (content.length >= 32 || resultBytes >= MAX_RESULT_BYTES) {
          truncated = true;
          break;
        }
        if (block.type === "text" && "text" in block && typeof block.text === "string") {
          const text = block.text.slice(
            0,
            Math.floor((MAX_RESULT_BYTES - resultBytes) / 4),
          );
          content.push({ type: "text", text });
          resultBytes += Buffer.byteLength(text, "utf8");
          if (text.length < block.text.length) truncated = true;
          continue;
        }
        if (block.type === "resource" && "resource" in block && block.resource && typeof block.resource === "object" && "text" in block.resource && typeof block.resource.text === "string") {
          const text = block.resource.text.slice(
            0,
            Math.floor((MAX_RESULT_BYTES - resultBytes) / 4),
          );
          content.push({ type: "resource", uri: "uri" in block.resource && typeof block.resource.uri === "string" ? block.resource.uri.slice(0, 256) : "", text });
          resultBytes += Buffer.byteLength(text, "utf8");
          if (text.length < block.resource.text.length) truncated = true;
          continue;
        }
        if (block.type === "resource_link" && "uri" in block && typeof block.uri === "string" && "name" in block && typeof block.name === "string") {
          content.push({
            type: "resource_link",
            uri: block.uri.slice(0, 256),
            name: block.name.slice(0, 80),
          });
        }
      }
      const output = {
        isError: "isError" in rawResponse && rawResponse.isError === true,
        content,
        ...(truncated ? { truncated: true } : {}),
      };
      let auditWarning: string | undefined;
      try {
        await this.audit(
          server.name,
          name,
          response.isError ? "tool-error" : "ok",
        );
      } catch (error) {
        auditWarning =
          error instanceof Error ? error.message : "Audit log write failed.";
      }
      const serialized = JSON.stringify({
        ...output,
        ...(auditWarning ? { auditWarning } : {}),
      });
      return serialized;
    } catch (error) {
      let auditError: unknown;
      try {
        await this.audit(server.name, name, "failed");
      } catch (cause) {
        auditError = cause;
      }
      const auditNote =
        auditError instanceof Error
          ? ` Audit logging also failed: ${auditError.message}`
          : "";
      throw new Error(
        `MCP tool ${name} failed: ${error instanceof Error ? error.message : "tool call failed"}.${auditNote}`,
        { cause: error },
      );
    }
  }

  async closeAll() {
    const clients = [...this.live.values()].map(({ client }) => client.close());
    this.live.clear();
    await Promise.allSettled(clients);
  }

  private decrypt(value: string) {
    return this.storage.decryptString(Buffer.from(value, "base64"));
  }

  private async readServers(): Promise<StoredServer[]> {
    try {
      const raw = await readFile(this.configPath);
      if (raw.byteLength > MAX_CONFIG_BYTES)
        throw new Error("MCP registry file exceeds its size limit.");
      const parsed: unknown = JSON.parse(raw.toString("utf8"));
      if (!Array.isArray(parsed))
        throw new Error("MCP registry file is invalid.");
      return (parsed as StoredServer[]).map((server) => {
        if (!server.encryptedArgs) return server;
        return { ...server, args: JSON.parse(this.decrypt(server.encryptedArgs)) as string[] };
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }

  private async writeServers(servers: StoredServer[]) {
    await mkdir(dirname(this.configPath), { recursive: true });
    const temporaryPath = `${this.configPath}.${randomUUID()}.tmp`;
    const persisted = servers.map((server) => {
      if (!server.encryptedArgs) return server;
      const { args: _args, ...encrypted } = server;
      return encrypted;
    });
    await writeFile(temporaryPath, JSON.stringify(persisted), {
      mode: 0o600,
      flag: "wx",
    });
    await rename(temporaryPath, this.configPath);
  }

  private async audit(server: string, action: string, status: string) {
    const path = `${this.configPath}.audit.jsonl`;
    await mkdir(dirname(path), { recursive: true });
    await appendFile(
      path,
      `${JSON.stringify({ at: new Date().toISOString(), server, action, status })}\n`,
      { mode: 0o600 },
    );
  }
}
