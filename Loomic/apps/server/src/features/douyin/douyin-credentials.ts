import type { ServerEnv } from "../../config/env.js";

type FetchLike = typeof fetch;

type TokenState = {
  value: string;
  expiresAt: number;
};

type DouyinCredentialOptions = {
  clientKey?: string;
  clientSecret?: string;
  fetchImpl?: FetchLike;
  refreshSkewMs?: number;
};

export type DouyinCredentialStatus = {
  configured: boolean;
  clientTokenExpiresAt: string | null;
  openTicketExpiresAt: string | null;
  lastRefreshAt: string | null;
  lastError: string | null;
  refreshSkewSeconds: number;
};

type DouyinTokenResponse = {
  data?: {
    access_token?: string;
    expires_in?: number;
    error_code?: number;
    description?: string;
    ticket?: string;
  };
  message?: string;
};

const DEFAULT_REFRESH_SKEW_MS = 5 * 60 * 1000;
const DEFAULT_TOKEN_TTL_MS = 2 * 60 * 60 * 1000;

export class DouyinCredentialError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "DouyinCredentialError";
    this.code = code;
  }
}

export class DouyinCredentialManager {
  private readonly clientKey: string | undefined;
  private readonly clientSecret: string | undefined;
  private readonly fetchImpl: FetchLike;
  private readonly refreshSkewMs: number;
  private clientToken: TokenState | null = null;
  private openTicket: TokenState | null = null;
  private refreshPromise: Promise<TokenState> | null = null;
  private ticketPromise: Promise<TokenState> | null = null;
  private lastRefreshAt: number | null = null;
  private lastError: string | null = null;
  private refreshTimer: NodeJS.Timeout | null = null;

  constructor(options: DouyinCredentialOptions) {
    this.clientKey = options.clientKey;
    this.clientSecret = options.clientSecret;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.refreshSkewMs = options.refreshSkewMs ?? DEFAULT_REFRESH_SKEW_MS;
  }

  static fromEnv(env: ServerEnv): DouyinCredentialManager {
    return new DouyinCredentialManager({
      ...(env.douyinClientKey ? { clientKey: env.douyinClientKey } : {}),
      ...(env.douyinClientSecret ? { clientSecret: env.douyinClientSecret } : {}),
    });
  }

  start(): void {
    if (this.refreshTimer || !this.isConfigured()) return;
    void this.getClientToken().catch((error) => this.recordError(error));
    this.refreshTimer = setInterval(() => {
      void this.getClientToken().catch((error) => this.recordError(error));
    }, 5 * 60 * 1000);
    this.refreshTimer.unref();
  }

  stop(): void {
    if (!this.refreshTimer) return;
    clearInterval(this.refreshTimer);
    this.refreshTimer = null;
  }

  isConfigured(): boolean {
    return Boolean(this.clientKey && this.clientSecret);
  }

  status(): DouyinCredentialStatus {
    return {
      configured: this.isConfigured(),
      clientTokenExpiresAt: this.clientToken ? new Date(this.clientToken.expiresAt).toISOString() : null,
      openTicketExpiresAt: this.openTicket ? new Date(this.openTicket.expiresAt).toISOString() : null,
      lastRefreshAt: this.lastRefreshAt ? new Date(this.lastRefreshAt).toISOString() : null,
      lastError: this.lastError,
      refreshSkewSeconds: Math.round(this.refreshSkewMs / 1000),
    };
  }

  async getClientToken(): Promise<string> {
    if (!this.isConfigured()) {
      throw new DouyinCredentialError("douyin_credentials_not_configured", "Douyin client credentials are not configured");
    }
    if (this.isUsable(this.clientToken)) return this.clientToken.value;
    if (!this.refreshPromise) {
      this.refreshPromise = this.fetchClientToken().finally(() => {
        this.refreshPromise = null;
      });
    }
    return (await this.refreshPromise).value;
  }

  async getOpenTicket(): Promise<string> {
    if (this.isUsable(this.openTicket)) return this.openTicket.value;
    if (!this.ticketPromise) {
      this.ticketPromise = this.fetchOpenTicket().finally(() => {
        this.ticketPromise = null;
      });
    }
    return (await this.ticketPromise).value;
  }

  private async fetchClientToken(): Promise<TokenState> {
    try {
      const response = await this.fetchImpl("https://open.douyin.com/oauth/client_token/", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          client_key: this.clientKey,
          client_secret: this.clientSecret,
          grant_type: "client_credential",
        }),
      });
      const payload = await parseResponse(response);
      const data = payload.data;
      const value = data?.access_token;
      if (!response.ok || !value) {
        throw new DouyinCredentialError("douyin_client_token_failed", describeFailure(payload, response.status));
      }
      const state = buildState(value, data?.expires_in);
      this.clientToken = state;
      this.openTicket = null;
      this.lastRefreshAt = Date.now();
      this.lastError = null;
      return state;
    } catch (error) {
      this.recordError(error);
      throw error;
    }
  }

  private async fetchOpenTicket(): Promise<TokenState> {
    try {
      const token = await this.getClientToken();
      const response = await this.fetchImpl("https://open.douyin.com/open/getticket/", {
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          "access-token": token,
        },
      });
      const payload = await parseResponse(response);
      const data = payload.data;
      const value = data?.ticket;
      if (!response.ok || !value) {
        throw new DouyinCredentialError("douyin_open_ticket_failed", describeFailure(payload, response.status));
      }
      const state = buildState(value, data?.expires_in);
      this.openTicket = state;
      this.lastError = null;
      return state;
    } catch (error) {
      this.recordError(error);
      throw error;
    }
  }

  private isUsable(state: TokenState | null): state is TokenState {
    return Boolean(state && state.expiresAt - this.refreshSkewMs > Date.now());
  }

  private recordError(error: unknown): void {
    this.lastError = error instanceof Error ? error.message : "Douyin credential refresh failed";
  }
}

function buildState(value: string, expiresIn?: number): TokenState {
  const ttlMs = Number.isFinite(expiresIn) && Number(expiresIn) > 0
    ? Number(expiresIn) * 1000
    : DEFAULT_TOKEN_TTL_MS;
  return { value, expiresAt: Date.now() + ttlMs };
}

async function parseResponse(response: Response): Promise<DouyinTokenResponse> {
  try {
    return await response.json() as DouyinTokenResponse;
  } catch {
    throw new DouyinCredentialError("douyin_invalid_response", `Douyin credential endpoint returned HTTP ${response.status}`);
  }
}

function describeFailure(payload: DouyinTokenResponse, status: number): string {
  const code = payload.data?.error_code;
  const detail = payload.data?.description ?? payload.message ?? `HTTP ${status}`;
  return code === undefined ? detail : `${detail} (${code})`;
}
