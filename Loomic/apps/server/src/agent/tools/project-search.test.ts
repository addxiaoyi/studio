import { expect, it, vi } from "vitest";
import type { BackendProtocol } from "deepagents";
import { runProjectSearch } from "./project-search.js";

it("returns a nonfatal result when workspace storage is unavailable", async () => {
  const backend = {
    grepRaw: vi.fn().mockRejectedValue(new Error("Store is required but not available in StateAndStore")),
  } as unknown as BackendProtocol;

  await expect(runProjectSearch(backend, { query: "video" })).resolves.toMatchObject({
    matchCount: 0,
    matches: [],
    summary: expect.stringContaining("temporarily unavailable"),
  });
});

it("returns workspace matches normally", async () => {
  const backend = {
    grepRaw: vi.fn().mockResolvedValue([{ path: "/workspace/readme.md", line: 3, text: "video model" }]),
  } as unknown as BackendProtocol;

  await expect(runProjectSearch(backend, { query: "video" })).resolves.toMatchObject({
    matchCount: 1,
    matches: [{ path: "/workspace/readme.md", line: 3, text: "video model" }],
  });
});
