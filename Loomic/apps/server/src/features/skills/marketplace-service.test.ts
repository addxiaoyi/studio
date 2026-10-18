import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getMarketplaceDetail,
  installFromMarketplace,
} from "./marketplace-service.js";

const skillUrl = "https://github.com/anthropics/skills/tree/HEAD/frontend-design";
const skillMd = [
  "---",
  "name: frontend-design",
  "description: Build polished frontend experiences.",
  "---",
  "",
  "# Frontend design",
].join("\n");

function githubContents() {
  return [
    {
      name: "SKILL.md",
      path: "frontend-design/SKILL.md",
      type: "file",
      download_url:
        "https://raw.githubusercontent.com/anthropics/skills/main/frontend-design/SKILL.md",
      size: skillMd.length,
    },
  ];
}

function githubFallbackFetch(url: string) {
  if (url === "https://api.github.com/repos/anthropics/skills/contents/frontend-design") {
    return new Response(JSON.stringify(githubContents()), { status: 200 });
  }
  if (url === "https://raw.githubusercontent.com/anthropics/skills/main/frontend-design/SKILL.md") {
    return new Response(skillMd, { status: 200 });
  }
  throw new Error(`Unexpected fetch: ${url}`);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("skills marketplace GitHub fallback", () => {
  it("imports a subdirectory skill from skills.sh", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({ files: [{ path: "SKILL.md", contents: skillMd }] }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await installFromMarketplace(skillUrl);

    expect(result.imported.manifest.name).toBe("frontend-design");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://skills.sh/api/download/anthropics/skills/frontend-design",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("falls back to GitHub after a skills.sh 404 without sending ref=HEAD", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = String(input);
      if (url.startsWith("https://skills.sh/")) {
        return new Response("missing", { status: 404 });
      }
      return githubFallbackFetch(url);
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await installFromMarketplace(skillUrl);
    const urls = fetchMock.mock.calls.map(([input]) => String(input));

    expect(result.imported.manifest.name).toBe("frontend-design");
    expect(urls).toContain(
      "https://api.github.com/repos/anthropics/skills/contents/frontend-design",
    );
    expect(urls.some((url) => url.includes("ref=HEAD"))).toBe(false);
  });

  it("falls back to GitHub after a skills.sh timeout", async () => {
    let attempt = 0;
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = String(input);
      if (url.startsWith("https://skills.sh/")) {
        attempt += 1;
        throw new Error("upstream timeout");
      }
      return githubFallbackFetch(url);
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await installFromMarketplace(skillUrl);

    expect(attempt).toBe(1);
    expect(result.imported.skillContent).toBe(skillMd);
  });

  it("resolves HEAD to the repository default branch for marketplace details", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = String(input);
      if (url.startsWith("https://skills.sh/")) {
        return new Response("missing", { status: 404 });
      }
      if (url === "https://api.github.com/repos/anthropics/skills") {
        return new Response(
          JSON.stringify({
            name: "skills",
            description: "Anthropic skills",
            stargazers_count: 1,
            default_branch: "main",
            owner: { login: "anthropics" },
            html_url: "https://github.com/anthropics/skills",
          }),
          { status: 200 },
        );
      }
      if (url === "https://raw.githubusercontent.com/anthropics/skills/main/frontend-design/SKILL.md") {
        return new Response(skillMd, { status: 200 });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const detail = await getMarketplaceDetail(skillUrl);

    expect(detail.version).toBe("main");
    expect(detail.readme).toBe(skillMd);
  });
});
