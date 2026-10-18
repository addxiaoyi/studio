import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import pg from "pg";

const sources = [
  { id: "aitools101-cookbook", repo: "https://github.com/AITOOLS101/ai-image-prompt-cookbook.git", license: "CC-BY-4.0", kind: "cookbook" },
  { id: "gpt-image2-ecommerce", repo: "https://github.com/buluslan/gpt-image2-ecommerce.git", license: "MIT", kind: "ecommerce" },
  { id: "youmind-seedance", repo: "https://github.com/YouMind-OpenLab/awesome-seedance-2-prompts.git", license: "CC-BY-4.0", kind: "seedance" },
  { id: "lanshu-video-kit", repo: "https://github.com/cclank/lanshu-awesome-ai-video-kit.git", license: "MIT", kind: "video-kit" },
];

function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ["ignore", "ignore", "pipe"] });
    let error = "";
    child.stderr.on("data", (chunk) => { error += chunk; });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(`${command} failed: ${error.slice(0, 500)}`)));
  });
}

function uuid(source, key) {
  const hex = createHash("sha256").update(`${source}:${key}`).digest("hex").slice(0, 32).split("");
  hex[12] = "4";
  hex[16] = ((Number.parseInt(hex[16], 16) & 3) | 8).toString(16);
  return `${hex.slice(0,8).join("")}-${hex.slice(8,12).join("")}-${hex.slice(12,16).join("")}-${hex.slice(16,20).join("")}-${hex.slice(20).join("")}`;
}

const clean = (value, max) => String(value ?? "").trim().slice(0, max);
const tags = (value) => [...new Set((Array.isArray(value) ? value : []).map((tag) => clean(tag, 40)).filter(Boolean))].slice(0, 20);

async function parseCookbook(root) {
  const body = JSON.parse(await readFile(join(root, "data", "prompts.zh.json"), "utf8"));
  return (body.prompts ?? []).map((item) => ({ key: item.id, title: item.title, prompt: item.prompt, category: `图片 / ${item.category ?? "通用"}`, tags: [item.category, item.scenario], url: item.sourceUrl }));
}

async function parseVideoKit(root) {
  const body = JSON.parse(await readFile(join(root, "prompts", "data", "all-prompts.json"), "utf8"));
  return (body.prompts ?? []).map((item) => ({ key: item.id, title: item.title, prompt: item.prompt, category: `视频 / ${item.category ?? item.model ?? "通用"}`, tags: [item.model, ...(item.tags ?? [])], url: item.source?.url }));
}

async function parseEcommerce(root) {
  const dir = join(root, "references", "scenarios");
  const files = (await readdir(dir)).filter((name) => name.endsWith(".json"));
  const entries = [];
  for (const file of files) {
    const item = JSON.parse(await readFile(join(dir, file), "utf8"));
    const template = item.prompt_template;
    const prompt = typeof template === "string" ? template : template?.template ?? template?.prompt ?? JSON.stringify(template);
    if (prompt) entries.push({ key: item.id ?? file, title: item.name ?? item.id, prompt, category: "图片 / 电商", tags: item.keywords ?? [], url: "https://github.com/buluslan/gpt-image2-ecommerce" });
  }
  return entries;
}

async function parseSeedance(root) {
  const markdown = await readFile(join(root, "README.md"), "utf8");
  const blocks = [...markdown.matchAll(/###\s+([^\n]+)[\s\S]*?####\s+📝\s+Prompt\s*\n+```[^\n]*\n([\s\S]*?)```/g)];
  return blocks.map((match, index) => ({ key: `readme-${index}-${match[1]}`, title: match[1], prompt: match[2], category: "视频 / Seedance", tags: ["Seedance", "视频"], url: "https://github.com/YouMind-OpenLab/awesome-seedance-2-prompts" }));
}

const parsers = { cookbook: parseCookbook, "video-kit": parseVideoKit, ecommerce: parseEcommerce, seedance: parseSeedance };
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const temp = await mkdtemp(join(tmpdir(), "helstera-prompts-"));
const report = [];
try {
  for (const source of sources) {
    const root = join(temp, source.id);
    try {
      await run("git", ["clone", "--depth", "1", source.repo, root], temp);
      const entries = await parsers[source.kind](root);
      let imported = 0;
      for (const item of entries) {
        const prompt = clean(item.prompt, 12000);
        if (!prompt) continue;
        const key = clean(item.key || createHash("sha256").update(prompt).digest("hex"), 240);
        await db.query(
          `insert into prompt_entries(id,title,prompt,category,tags,published,source,source_key,source_url,license,updated_at)
           values($1,$2,$3,$4,$5,true,$6,$7,$8,$9,now())
           on conflict(source,source_key) where source is not null and source_key is not null
           do update set title=excluded.title,prompt=excluded.prompt,category=excluded.category,tags=excluded.tags,published=true,source_url=excluded.source_url,license=excluded.license,deleted_at=null,updated_at=now()`,
          [uuid(source.id, key), clean(item.title || "未命名提示词", 160), prompt, clean(item.category, 80), tags(item.tags), source.id, key, clean(item.url || source.repo.replace(/\.git$/, ""), 500), source.license],
        );
        imported += 1;
      }
      report.push({ source: source.id, imported });
    } catch (error) {
      report.push({ source: source.id, error: error instanceof Error ? error.message : String(error) });
    }
  }
  console.log(JSON.stringify(report));
} finally {
  await db.end();
  await rm(temp, { recursive: true, force: true });
}
