/**
 * Marketplace Service for skills.sh
 *
 * Skills on skills.sh are NOT npm packages — they are GitHub repositories
 * containing SKILL.md files. The skills.sh platform provides:
 * - A web frontend for browsing/searching skills
 * - A download API that returns skill files as JSON
 *
 * API endpoints:
 * - Download: GET https://skills.sh/api/download/{owner}/{repo}/{slug}
 *   Returns: { files: [{path, contents}], hash }
 *
 * For search, we use the npm registry as a discovery layer (packages with
 * "agent-skill" keyword link back to GitHub repos), then install via
 * GitHub import or skills.sh download API.
 *
 * @module marketplace-service
 */

import {
  importFromGitHub,
  importFromTarballUrl,
  parseSkillManifest,
  type ImportedSkill,
  SkillImportError,
} from "./skill-import-service.js";

// ── Constants ──────────────────────────────────────────────────────────────

const NPM_REGISTRY_BASE = "https://registry.npmjs.org";
const SKILLS_SH_BASE = "https://skills.sh";
const SKILL_KEYWORD = "agent-skill";
const USER_AGENT = "Helstera-Marketplace/1.0";
const MAX_PAGE_SIZE = 50;
const FETCH_TIMEOUT_MS = 15_000;
const GITHUB_API_BASE = "https://api.github.com";
const SKILLS_SH_DISCOVERY_QUERIES = ["ai", "image", "video", "design", "code"];

const FEATURED_SKILLS: MarketplaceSkill[] = [
  { packageName: "https://github.com/YouMind-OpenLab/awesome-gpt-image-2-prompts", name: "awesome-gpt-image-2-prompts", description: "GPT Image 电商、海报、产品摄影与 UI 提示词库", author: "YouMind-OpenLab", version: "main", downloads: 8500, keywords: ["image", "prompt", "ecommerce"], homepage: "https://github.com/YouMind-OpenLab/awesome-gpt-image-2-prompts", repository: "https://github.com/YouMind-OpenLab/awesome-gpt-image-2-prompts", license: "CC-BY-4.0" },
  { packageName: "https://github.com/YouMind-OpenLab/awesome-seedance-2-prompts", name: "awesome-seedance-2-prompts", description: "Seedance、Kling、Sora、Veo 视频提示词与镜头运动模板", author: "YouMind-OpenLab", version: "main", downloads: 2000, keywords: ["video", "seedance", "sora"], homepage: "https://github.com/YouMind-OpenLab/awesome-seedance-2-prompts", repository: "https://github.com/YouMind-OpenLab/awesome-seedance-2-prompts" },
  { packageName: "https://github.com/AITOOLS101/ai-image-prompt-cookbook", name: "ai-image-prompt-cookbook", description: "中文电商图片提示词模板，支持变量化复用", author: "AITOOLS101", version: "main", downloads: 1000, keywords: ["image", "ecommerce", "中文"], homepage: "https://github.com/AITOOLS101/ai-image-prompt-cookbook", repository: "https://github.com/AITOOLS101/ai-image-prompt-cookbook" },
  { packageName: "https://github.com/willwulfken/MidJourney-Styles-and-Keywords-Reference", name: "MidJourney Styles Reference", description: "镜头、光影、材质和艺术风格关键词参考库", author: "willwulfken", version: "main", downloads: 4000, keywords: ["style", "lighting", "camera"], homepage: "https://github.com/willwulfken/MidJourney-Styles-and-Keywords-Reference", repository: "https://github.com/willwulfken/MidJourney-Styles-and-Keywords-Reference" },
];

// ── Error Class ────────────────────────────────────────────────────────────

export class MarketplaceError extends Error {
  constructor(
    public readonly code: "search_failed" | "package_not_found" | "install_failed",
    message: string,
  ) {
    super(message);
    this.name = "MarketplaceError";
  }
}

// ── Types ──────────────────────────────────────────────────────────────────

export interface MarketplaceSkill {
  packageName: string;
  name: string;
  description: string;
  author: string;
  version: string;
  downloads: number;
  keywords: string[];
  homepage?: string;
  repository?: string;
  license?: string;
}

export interface MarketplaceSearchResult {
  skills: MarketplaceSkill[];
  total: number;
}

export interface MarketplaceSkillDetail extends MarketplaceSkill {
  readme: string;
  versions: string[];
  tarballUrl: string;
  /** GitHub repo URL if discoverable (for skills.sh download API) */
  repoUrl?: string;
}

// ── Internal Helpers ───────────────────────────────────────────────────────

async function registryFetch(url: string): Promise<Response> {
  const response = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (response.status === 404) {
    throw new MarketplaceError("package_not_found", `Package not found: ${url}`);
  }
  if (!response.ok) {
    throw new MarketplaceError("search_failed", `Registry request failed: ${response.status} for ${url}`);
  }
  return response;
}

/**
 * Try to extract a GitHub repo URL from npm package metadata.
 * Looks at repository field and homepage.
 */
function extractGitHubRepo(pkg: Record<string, unknown>): string | undefined {
  // Check repository field
  const repo = pkg.repository;
  if (typeof repo === "string" && repo.includes("github.com")) {
    return normalizeGitHubUrl(repo);
  }
  if (repo && typeof repo === "object" && "url" in repo) {
    const repoUrl = (repo as { url: string }).url;
    if (repoUrl.includes("github.com")) {
      return normalizeGitHubUrl(repoUrl);
    }
  }
  // Check homepage
  const homepage = pkg.homepage;
  if (typeof homepage === "string" && homepage.includes("github.com")) {
    return normalizeGitHubUrl(homepage);
  }
  return undefined;
}

function normalizeGitHubUrl(raw: string): string {
  // git+https://github.com/owner/repo.git → https://github.com/owner/repo
  // git://github.com/owner/repo.git → https://github.com/owner/repo
  let url = raw
    .replace(/^git\+/, "")
    .replace(/^git:\/\//, "https://")
    .replace(/\.git$/, "");
  // Ensure https://
  if (url.startsWith("github.com")) {
    url = `https://${url}`;
  }
  return url;
}

// ── Search ─────────────────────────────────────────────────────────────────

/**
 * Search the npm registry for skill packages.
 * Uses `keywords:agent-skill` to scope results.
 */
export async function searchMarketplace(
  query: string,
  page: number = 1,
  limit: number = 20,
): Promise<MarketplaceSearchResult> {
  const safePage = Math.max(1, Math.min(page, 100));
  const safeLimit = Math.max(1, Math.min(limit, MAX_PAGE_SIZE));
  const search = query.trim();
  if (!search) return searchSkillsSh(safeLimit);
  const params = new URLSearchParams({ q: `${search} SKILL.md in:readme,description`, sort: "stars", order: "desc", page: String(safePage), per_page: String(Math.min(safeLimit * 3, 100)) });
  const response = await fetch(`${GITHUB_API_BASE}/search/repositories?${params}`, { headers: { Accept: "application/vnd.github+json", "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!response.ok) {
    const fallback = FEATURED_SKILLS.filter((skill) => `${skill.name} ${skill.description} ${skill.keywords.join(" ")}`.toLowerCase().includes(search.toLowerCase()));
    if (fallback.length) return { skills: fallback.slice(0, safeLimit), total: fallback.length };
    throw new MarketplaceError("search_failed", `GitHub search failed: ${response.status}`);
  }
  const data = await response.json() as { items: Array<{ name:string; full_name:string; html_url:string; description:string|null; stargazers_count:number; topics?:string[]; license?:{spdx_id?:string}; owner:{login:string}; default_branch:string }> };
  const candidates = await Promise.all(data.items.map(async (repo) => {
    const skillMd = await fetch(`${GITHUB_API_BASE}/repos/${repo.full_name}/contents/SKILL.md`, { headers: { Accept: "application/vnd.github+json", "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }).catch(() => null);
    if (!skillMd?.ok) return null;
    return { packageName: repo.html_url, name: repo.name, description: repo.description ?? "GitHub Agent Skill", author: repo.owner.login, version: repo.default_branch, downloads: repo.stargazers_count, keywords: repo.topics ?? [], homepage: repo.html_url, repository: repo.html_url, ...(repo.license?.spdx_id ? { license: repo.license.spdx_id } : {}) } satisfies MarketplaceSkill;
  }));
  const skills: MarketplaceSkill[] = [];
  for (const item of candidates) {
    if (item) skills.push(item);
    if (skills.length === safeLimit) break;
  }
  return { skills, total: skills.length };
}

async function searchSkillsSh(limit: number): Promise<MarketplaceSearchResult> {
  const responses = await Promise.all(
    SKILLS_SH_DISCOVERY_QUERIES.map(async (query) => {
      try {
        const response = await fetch(`${SKILLS_SH_BASE}/api/search?q=${encodeURIComponent(query)}`, {
          headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });
        if (!response.ok) return [];
        const data = (await response.json()) as { skills?: Array<{ id: string; source: string; skillId: string; name: string; installs?: number }> };
        return data.skills ?? [];
      } catch {
        return [];
      }
    }),
  );

  const unique = new Map<string, { id: string; source: string; skillId: string; name: string; installs?: number }>();
  for (const skills of responses) {
    for (const skill of skills) unique.set(skill.id, skill);
  }

  const skills = [...unique.values()]
    .sort((left, right) => (right.installs ?? 0) - (left.installs ?? 0))
    .slice(0, limit)
    .map((skill) => {
      const [owner, repo] = skill.source.split("/");
      const packageName = `https://github.com/${skill.source}/tree/HEAD/${skill.skillId}`;
      return {
        packageName,
        name: skill.name || skill.skillId,
        description: `社区 Agent Skill · ${skill.skillId}`,
        author: owner ?? skill.source,
        version: "HEAD",
        downloads: skill.installs ?? 0,
        keywords: [skill.skillId],
        homepage: packageName,
        repository: owner && repo ? `https://github.com/${owner}/${repo}` : packageName,
      } satisfies MarketplaceSkill;
    });

  if (skills.length > 0) return { skills, total: unique.size };
  return { skills: FEATURED_SKILLS.slice(0, limit), total: FEATURED_SKILLS.length };
}

// ── Detail ─────────────────────────────────────────────────────────────────

/**
 * Get full detail for a package from the npm registry.
 */
export async function getMarketplaceDetail(
  packageName: string,
): Promise<MarketplaceSkillDetail> {
  if (packageName.startsWith("https://github.com/")) {
    const match = packageName.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)(?:\/tree\/([^/]+)\/(.+))?/);
    if (!match) throw new MarketplaceError("package_not_found", "Invalid GitHub repository URL");
    const fullName = `${match[1]}/${match[2]}`;
    const ref = match[3] ?? "HEAD";
    const skillPath = match[4];
    if (skillPath) {
      const slug = skillPath.split("/").filter(Boolean).at(-1) ?? skillPath;
      const response = await fetch(`${SKILLS_SH_BASE}/api/download/${match[1]}/${match[2]}/${encodeURIComponent(slug)}`, {
        headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (response.ok) {
        const data = (await response.json()) as { files?: Array<{ path: string; contents: string }> };
        const skillMd = data.files?.find((file) => file.path.toUpperCase() === "SKILL.MD");
        if (skillMd) {
          const manifest = parseSkillManifest(skillMd.contents);
          return {
            packageName,
            name: manifest.name || slug,
            description: manifest.description || `社区 Agent Skill · ${slug}`,
            author: match[1]!,
            version: ref,
            downloads: 0,
            keywords: [slug],
            homepage: packageName,
            repository: `https://github.com/${fullName}`,
            readme: skillMd.contents,
            versions: [ref],
            tarballUrl: "",
            repoUrl: packageName,
          };
        }
      }
    }
    const repoResponse = await fetch(`${GITHUB_API_BASE}/repos/${fullName}`, { headers: { Accept: "application/vnd.github+json", "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!repoResponse.ok) throw new MarketplaceError("package_not_found", "GitHub skill repository is unavailable");
    const repo = await repoResponse.json() as { name:string; description:string|null; stargazers_count:number; topics?:string[]; default_branch:string; owner:{login:string}; html_url:string; license?:{spdx_id?:string} };
    const resolvedRef = ref === "HEAD" ? repo.default_branch : ref;
    const skillResponse = await fetch(`https://raw.githubusercontent.com/${fullName}/${resolvedRef}/${skillPath ? `${skillPath}/` : ""}SKILL.md`, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!skillResponse.ok) throw new MarketplaceError("package_not_found", "GitHub skill repository is unavailable");
    return { packageName, name: repo.name, description: repo.description ?? "GitHub Agent Skill", author: repo.owner.login, version: resolvedRef, downloads: repo.stargazers_count, keywords: repo.topics ?? [], homepage: repo.html_url, repository: repo.html_url, ...(repo.license?.spdx_id ? { license: repo.license.spdx_id } : {}), readme: await skillResponse.text(), versions: [resolvedRef], tarballUrl: "", repoUrl: packageName };
  }
  console.log(`[marketplace] Fetching detail for package: ${packageName}`);

  const encoded = encodeURIComponent(packageName).replace("%40", "@");
  const response = await registryFetch(`${NPM_REGISTRY_BASE}/${encoded}`);
  const data = (await response.json()) as Record<string, unknown>;

  const distTags = data["dist-tags"] as Record<string, string> | undefined;
  const latestVersion = distTags?.latest ?? "0.0.0";
  const versions = data.versions as Record<string, Record<string, unknown>> | undefined;
  const latestMeta = versions?.[latestVersion];
  const tarballUrl = (latestMeta?.dist as { tarball?: string } | undefined)?.tarball ?? "";

  const authorRaw = data.author;
  const authorName = typeof authorRaw === "string"
    ? authorRaw
    : (authorRaw as { name?: string } | undefined)?.name ?? "unknown";

  const repoUrl = extractGitHubRepo(data);

  const result: MarketplaceSkillDetail = {
    packageName,
    name: (data.name as string) ?? packageName,
    description: (data.description as string) ?? "",
    author: authorName,
    version: latestVersion,
    downloads: 0,
    keywords: (data.keywords as string[]) ?? [],
    readme: (data.readme as string) ?? "",
    versions: versions ? Object.keys(versions) : [],
    tarballUrl,
  };

  if (data.license) result.license = data.license as string;
  if (data.homepage) result.homepage = data.homepage as string;
  if (repoUrl) {
    result.repository = repoUrl;
    result.repoUrl = repoUrl;
  }

  console.log(
    `[marketplace] Detail fetched: ${packageName}@${latestVersion} (${result.versions.length} versions, tarball=${tarballUrl})`,
  );

  return result;
}

// ── Install ────────────────────────────────────────────────────────────────

/**
 * Install a skill from the marketplace.
 *
 * Strategy (in order of preference):
 * 1. If package has a GitHub repo link → use skills.sh download API
 * 2. If skills.sh fails → try GitHub import directly
 * 3. Fallback → download npm tarball and extract
 *
 * This multi-strategy approach handles the reality that skills.sh skills
 * are primarily GitHub repos, not npm packages.
 */
export async function installFromMarketplace(
  packageName: string,
): Promise<{ imported: ImportedSkill; packageName: string }> {
  if (packageName.startsWith("https://github.com/")) {
    try {
      const imported = await trySkillsShDownload(packageName);
      if (imported) return { imported, packageName };
    } catch (error) {
      console.log("[marketplace] direct skills.sh install failed, trying GitHub import:", error);
    }
    try {
      return { imported: await importFromGitHub(packageName), packageName };
    } catch (error) {
      throw new MarketplaceError("install_failed", error instanceof Error ? error.message : "GitHub skill import failed");
    }
  }
  console.log(`[marketplace] Installing skill from package: ${packageName}`);

  const detail = await getMarketplaceDetail(packageName);

  // Strategy 1: Try skills.sh download API if we have a GitHub repo
  if (detail.repoUrl) {
    try {
      const imported = await trySkillsShDownload(detail.repoUrl);
      if (imported) {
        console.log(`[marketplace] Installed via skills.sh download API: ${imported.manifest.name}`);
        return { imported, packageName };
      }
    } catch (err) {
      console.log(`[marketplace] skills.sh download failed, trying GitHub import: ${err}`);
    }

    // Strategy 2: Try direct GitHub import
    try {
      const imported = await importFromGitHub(detail.repoUrl);
      console.log(`[marketplace] Installed via GitHub import: ${imported.manifest.name} (${imported.files.length} files)`);
      return { imported, packageName };
    } catch (err) {
      console.log(`[marketplace] GitHub import failed, falling back to npm tarball: ${err}`);
    }
  }

  // Strategy 3: Fallback to npm tarball
  if (!detail.tarballUrl) {
    throw new MarketplaceError("install_failed", `No tarball URL available for ${packageName}`);
  }

  try {
    const imported = await importFromTarballUrl(detail.tarballUrl);
    console.log(`[marketplace] Installed via npm tarball: ${imported.manifest.name} (${imported.files.length} files)`);
    return { imported, packageName };
  } catch (err) {
    if (err instanceof SkillImportError) {
      throw new MarketplaceError("install_failed",
        `Failed to extract skill from "${packageName}": ${err.message}`);
    }
    throw err;
  }
}

// ── skills.sh Download API ─────────────────────────────────────────────────

/**
 * Try to download a skill via the skills.sh download API.
 *
 * The API returns: { files: [{path, contents}], hash }
 * This is the fastest way to get skill files without cloning a repo.
 */
async function trySkillsShDownload(repoUrl: string): Promise<ImportedSkill | null> {
  // Parse GitHub URL: https://github.com/owner/repo → owner, repo
  const parsed = new URL(repoUrl);
  const segments = parsed.pathname.split("/").filter(Boolean);
  if (segments.length < 2) return null;
  const owner = segments[0]!;
  const repo = segments[1]!;
  const treeIndex = segments.indexOf("tree");
  const skillPath = treeIndex >= 0 ? segments.slice(treeIndex + 2).join("/") : "";
  const slug = (skillPath.split("/").filter(Boolean).at(-1) ?? repo).replace(/[^a-z0-9-]/gi, "-").toLowerCase();
  const downloadUrl = `${SKILLS_SH_BASE}/api/download/${owner}/${repo}/${slug}`;
  console.log(`[marketplace] Trying skills.sh download: ${downloadUrl}`);

  try {
    const response = await fetch(downloadUrl, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (!response.ok) {
      console.log(`[marketplace] skills.sh returned ${response.status} for ${downloadUrl}`);
      return null;
    }

    const data = (await response.json()) as {
      files?: Array<{ path: string; contents: string }>;
      hash?: string;
    };

    if (!data.files?.length) {
      console.log(`[marketplace] skills.sh returned empty files for ${downloadUrl}`);
      return null;
    }

    // Find SKILL.md
    const skillMdFile = data.files.find(
      (f) => f.path.toUpperCase() === "SKILL.MD",
    );

    if (!skillMdFile) {
      console.log(`[marketplace] No SKILL.md in skills.sh response for ${downloadUrl}`);
      return null;
    }

    const manifest = parseSkillManifest(skillMdFile.contents);

    // Collect scripts/references/assets files
    const ALLOWED_DIR = /^(scripts|references|assets)\//i;
    const files = data.files
      .filter((f) => ALLOWED_DIR.test(f.path))
      .map((f) => ({
        filePath: f.path,
        content: f.contents,
        mimeType: "text/plain",
      }));

    console.log(
      `[marketplace] skills.sh download success: ${manifest.name} (${files.length} files)`,
    );

    return {
      manifest,
      skillContent: skillMdFile.contents,
      files,
      sourceUrl: repoUrl,
    };
  } catch (err) {
    console.log(`[marketplace] skills.sh download error: ${err}`);
    return null;
  }
}
