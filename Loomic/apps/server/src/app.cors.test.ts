import { describe, expect, it } from "vitest";
import type { FastifyRequest } from "fastify";
import { evaluateCors } from "./app.js";

function request(headers: Record<string, string>, method = "POST") {
  return { headers, method } as FastifyRequest;
}

describe("evaluateCors", () => {
  it("accepts the public same-origin request behind a reverse proxy", () => {
    const result = evaluateCors(
      request({
        origin: "https://studio.0st.top",
        host: "studio.0st.top",
        "x-forwarded-proto": "https",
      }),
      "http://localhost:3000",
    );

    expect(result.allowed).toBe(true);
    expect(result.allowOrigin).toBe("https://studio.0st.top");
    expect(result.allowCredentials).toBe(true);
  });

  it("rejects a different browser origin", () => {
    const result = evaluateCors(
      request({
        origin: "https://evil.example",
        host: "studio.0st.top",
        "x-forwarded-proto": "https",
      }),
      "https://studio.0st.top",
    );

    expect(result.allowed).toBe(false);
    expect(result.allowCredentials).toBe(false);
  });

  it("keeps the configured development origin working", () => {
    const result = evaluateCors(
      request({ origin: "http://localhost:3000", host: "localhost:3001" }),
      "http://localhost:3000",
    );

    expect(result.allowed).toBe(true);
    expect(result.allowCredentials).toBe(true);
  });
});
