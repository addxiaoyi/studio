import { describe, expect, it } from "vitest";

import { validateLocalExactUrl } from "./assistant-hub.js";

describe("local website assistant URL policy", () => {
  it("allows exact HTTP(S) local URLs without credentials", () => {
    expect(validateLocalExactUrl("http://127.0.0.1:4173/app?view=home").toString()).toBe("http://127.0.0.1:4173/app?view=home");
    expect(validateLocalExactUrl("https://intranet.example.test/login").hostname).toBe("intranet.example.test");
  });

  it.each(["file:///tmp/site", "javascript:alert(1)", "http://user:password@localhost/"]) (
    "rejects unsafe local URL %s",
    (url) => {
      expect(() => validateLocalExactUrl(url)).toThrow();
    },
  );
});
