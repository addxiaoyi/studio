type JsonRpcResult = {
  jsonrpc?: string;
  id?: number;
  result?: Record<string, unknown>;
  error?: { code?: number; message?: string; data?: unknown };
};

type PendingRequest = {
  resolve: (value: Record<string, unknown>) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};

export type DouyinMcpClientOptions = {
  serverUrl: string;
  token: string;
  toolGroupAid?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

const PROTOCOL_VERSION = "2025-06-18";
const DEFAULT_TIMEOUT_MS = 15_000;

export class DouyinMcpError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "DouyinMcpError";
    this.code = code;
  }
}

export class DouyinMcpClient {
  private readonly options: Required<Pick<DouyinMcpClientOptions, "serverUrl" | "token" | "timeoutMs" | "fetchImpl">> & Pick<DouyinMcpClientOptions, "toolGroupAid">;
  private readonly pending = new Map<number, PendingRequest>();
  private controller: AbortController | null = null;
  private messageUrl: string | null = null;
  private nextRequestId = 1;
  private endpointPromise: Promise<string> | null = null;
  private resolveEndpoint: ((value: string) => void) | null = null;
  private rejectEndpoint: ((error: Error) => void) | null = null;
  private initialized = false;

  constructor(options: DouyinMcpClientOptions) {
    this.options = {
      serverUrl: options.serverUrl,
      token: options.token,
      timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      fetchImpl: options.fetchImpl ?? fetch,
      ...(options.toolGroupAid ? { toolGroupAid: options.toolGroupAid } : {}),
    };
  }

  async connect(): Promise<void> {
    if (this.initialized) return;
    const url = new URL(this.options.serverUrl);
    url.searchParams.set("token", this.options.token);
    if (this.options.toolGroupAid) url.searchParams.set("tool_group_aid", this.options.toolGroupAid);

    this.controller = new AbortController();
    this.endpointPromise = new Promise<string>((resolve, reject) => {
      this.resolveEndpoint = resolve;
      this.rejectEndpoint = reject;
    });

    const response = await this.options.fetchImpl(url, {
      headers: { Accept: "text/event-stream" },
      signal: this.controller.signal,
    });
    if (!response.ok) throw new DouyinMcpError("connection_failed", `Douyin MCP SSE returned HTTP ${response.status}`);
    if (!response.body) throw new DouyinMcpError("connection_failed", "Douyin MCP SSE response has no body");

    void this.readEvents(response.body).catch((error) => this.fail(error instanceof Error ? error : new Error(String(error))));
    const endpoint = await this.withTimeout(this.endpointPromise, "MCP endpoint was not announced");
    this.messageUrl = new URL(endpoint, url).toString();
    await this.request("initialize", {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "helstera", version: "0.0.0" },
    });
    await this.notify("notifications/initialized");
    this.initialized = true;
  }

  async listTools(): Promise<Record<string, unknown>> {
    await this.connect();
    return this.request("tools/list", {});
  }

  async callTool(name: string, argumentsValue: Record<string, unknown>): Promise<Record<string, unknown>> {
    await this.connect();
    return this.request("tools/call", { name, arguments: argumentsValue });
  }

  close(): void {
    this.controller?.abort();
    this.controller = null;
    this.messageUrl = null;
    this.initialized = false;
    this.fail(new Error("Douyin MCP client closed"));
  }

  private async request(method: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (!this.messageUrl) throw new DouyinMcpError("not_connected", "Douyin MCP client is not connected");
    const id = this.nextRequestId++;
    const responsePromise = new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new DouyinMcpError("request_timeout", `Douyin MCP request timed out: ${method}`));
      }, this.options.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
    });
    const response = await this.options.fetchImpl(this.messageUrl, {
      method: "POST",
      headers: { Accept: "application/json, text/event-stream", "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
      ...(this.controller ? { signal: this.controller.signal } : {}),
    });
    if (!response.ok && response.status !== 202) {
      this.pending.get(id)?.reject(new DouyinMcpError("request_failed", `Douyin MCP request returned HTTP ${response.status}`));
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const payload = await response.json() as JsonRpcResult;
      this.resolveResponse(payload);
    }
    return responsePromise;
  }

  private async notify(method: string): Promise<void> {
    if (!this.messageUrl) return;
    await this.options.fetchImpl(this.messageUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method, params: {} }),
      ...(this.controller ? { signal: this.controller.signal } : {}),
    });
  }

  private async readEvents(body: ReadableStream<Uint8Array>): Promise<void> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const next = await reader.read();
      if (next.done) return;
      buffer += decoder.decode(next.value, { stream: true });
      const events = buffer.split(/\r?\n\r?\n/);
      buffer = events.pop() ?? "";
      for (const event of events) this.handleEvent(event);
    }
  }

  private handleEvent(event: string): void {
    const eventName = event.match(/^event:\s*(.+)$/m)?.[1]?.trim();
    const data = event.match(/^data:\s*(.*)$/m)?.[1]?.trim();
    if (!data) return;
    if (eventName === "endpoint" || data.startsWith("/message")) {
      this.resolveEndpoint?.(data);
      this.resolveEndpoint = null;
      this.rejectEndpoint = null;
      return;
    }
    try {
      this.resolveResponse(JSON.parse(data) as JsonRpcResult);
    } catch {
      // Ignore non-JSON SSE events such as keep-alives.
    }
  }

  private resolveResponse(payload: JsonRpcResult): void {
    if (typeof payload.id !== "number") return;
    const pending = this.pending.get(payload.id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(payload.id);
    if (payload.error) {
      pending.reject(new DouyinMcpError(`rpc_${payload.error.code ?? "error"}`, payload.error.message ?? "Douyin MCP request failed"));
      return;
    }
    pending.resolve(payload.result ?? {});
  }

  private fail(error: Error): void {
    this.rejectEndpoint?.(error);
    this.resolveEndpoint = null;
    this.rejectEndpoint = null;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  private async withTimeout<T>(promise: Promise<T>, message: string): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new DouyinMcpError("connection_timeout", message)), this.options.timeoutMs); }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
