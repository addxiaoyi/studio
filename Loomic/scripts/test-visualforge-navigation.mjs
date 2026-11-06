import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const files = [
  "apps/web/public/creative/visualforge/entry.mjs",
  "apps/web/public/creative/visualforge/browser-studio-vendor-entry.mjs",
];

const vendor = await readFile(files[1], "utf8");
const entry = await readFile(files[0], "utf8");
const translated = `${entry}\n${vendor}`;
for (const label of [
  "设置",
  "快捷键",
  "依赖包",
  "模型",
  "播放 / 暂停",
  "跳到开头",
  "硬件加速",
  "字幕样式库",
  "缩小时间线",
]) {
  assert.equal(translated.includes(label), true, `VisualForge bundles are missing translated label: ${label}`);
}

for (const file of files) {
  const source = await readFile(file, "utf8");
  assert.equal(
    source.includes("event.preventDefault(),event.returnValue=!0"),
    false,
    `${file} still contains an unconditional beforeunload guard`,
  );
}

console.log(`VisualForge navigation guard regression passed (${files.length} bundles).`);
