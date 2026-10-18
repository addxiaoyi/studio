import fs from "node:fs";
import path from "node:path";

const input = "C:/Users/l/.codex/attachments/e3b3d083-c66c-45e5-bf0b-00110e9f0694/已粘贴的文本.txt";
const target = path.resolve("packages/shared/src/upstream-pricing.ts");
const text = fs.readFileSync(input, "utf8");
const costs = new Map();
const duplicates = [];

for (const block of text.split(/快速测试/).slice(1)) {
  const lines = block.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const id = lines.find((line) => /^[a-z][a-z0-9._-]+$/i.test(line));
  const price = block.match(/(\d+(?:\.\d+)?)\s*\/(秒|次|100万token)起/);
  if (!id || !price) continue;
  const unit = price[2] === "秒" ? "per_second" : price[2] === "次" ? "per_generation" : "per_million_tokens";
  const item = { unit, costCny: Number(price[1]) };
  if (costs.has(id)) duplicates.push(id);
  costs.set(id, item);
}

const entries = [...costs.entries()].sort(([a], [b]) => a.localeCompare(b));
const map = entries.map(([id, value]) => `  ${JSON.stringify(id)}: ${JSON.stringify(value)},`).join("\n");
const source = fs.readFileSync(target, "utf8");
const start = source.indexOf("export const UPSTREAM_COSTS");
const open = source.indexOf("{", start);
const end = source.indexOf("};", open);
const replacement = `export const UPSTREAM_COSTS: Readonly<Record<string, UpstreamCost>> = {\n${map}\n}`;
fs.writeFileSync(target, `${source.slice(0, start)}${replacement}${source.slice(end + 2)}`, "utf8");
console.log(JSON.stringify({ entries: entries.length, duplicates: [...new Set(duplicates)].sort(), sample: entries.slice(0, 5) }, null, 2));
