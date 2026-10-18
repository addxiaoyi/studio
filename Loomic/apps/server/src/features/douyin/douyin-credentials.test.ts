import { describe, expect, it, vi } from "vitest";
import { DouyinCredentialManager } from "./douyin-credentials.js";

function response(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("DouyinCredentialManager", () => {
  it("caches a token and refreshes it inside the configured skew", async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls += 1;
      return response({ data: { access_token: `clt-${calls}`, expires_in: 7200 } });
    });
    const manager = new DouyinCredentialManager({
      clientKey: "key",
      clientSecret: "secret",
      fetchImpl,
      refreshSkewMs: 0,
    });

    await expect(manager.getClientToken()).resolves.toBe("clt-1");
    await expect(manager.getClientToken()).resolves.toBe("clt-1");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("serializes concurrent refreshes", async () => {
    const fetchImpl = vi.fn(async () => response({ data: { access_token: "clt-one", expires_in: 7200 } }));
    const manager = new DouyinCredentialManager({ clientKey: "key", clientSecret: "secret", fetchImpl });
    await expect(Promise.all([manager.getClientToken(), manager.getClientToken()])).resolves.toEqual(["clt-one", "clt-one"]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("gets and caches the open ticket using the client token", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      if (String(url).includes("client_token")) return response({ data: { access_token: "clt-one", expires_in: 7200 } });
      return response({ data: { ticket: "ticket-one", expires_in: 7200 } });
    });
    const manager = new DouyinCredentialManager({ clientKey: "key", clientSecret: "secret", fetchImpl });
    await expect(manager.getOpenTicket()).resolves.toBe("ticket-one");
    await expect(manager.getOpenTicket()).resolves.toBe("ticket-one");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(manager.status().openTicketExpiresAt).toBeTruthy();
  });
});
