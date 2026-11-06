import { parse } from "../../vendor/visualforge/packages/codemods/node_modules/@babel/parser";
import type { Node, JSXElement } from "../../vendor/visualforge/packages/codemods/node_modules/@babel/types";
import { resolveCompositionComponentInProject } from "../../vendor/visualforge/packages/codemods/src/resolve-composition-component-location";
import { applyCodemodChanges } from "../../vendor/visualforge/packages/codemods/src/codemod-project";
import { updateCompositionMetadata } from "../../vendor/visualforge/packages/codemods/src/update-composition-metadata";
import { findProjectFile } from "../../vendor/visualforge/packages/codemods/src/internals";
import type { VirtualProject } from "../../vendor/visualforge/packages/browser-studio/src/types";
import { studioCutSource, cutFrames, STUDIO_FPS, type StudioCut, type StudioCaption } from "../../apps/web/src/lib/studio-cut";
import { nativeCaptions } from "./native-captions";

export type StudioEdit = { id: string; compositionId: string; revision: string; cut: StudioCut; replaceVideo: boolean };
type EditedProject = VirtualProject & { loomicAppliedEdits?: string[]; loomicCuts?: Record<string, { revision: string; cut: StudioCut }> };

export async function projectFingerprint(project: VirtualProject, compositionId: string) {
  const bytes = new TextEncoder().encode(JSON.stringify({ compositionId, files: project.files, publicFiles: project.publicFiles }));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

function visit(node: Node, callback: (node: Node) => void) {
  callback(node);
  for (const [key, value] of Object.entries(node)) {
    if (["loc", "extra", "comments", "tokens"].includes(key)) continue;
    if (Array.isArray(value)) {
      for (const child of value) { if (child?.type) visit(child, callback); }
    } else if (value && typeof value === "object" && "type" in value) visit(value as Node, callback);
  }
}

function attribute(element: JSXElement, name: string): string | number | null {
  const prop = element.openingElement.attributes.find(item => item.type === "JSXAttribute" && item.name.name === name);
  if (!prop || prop.type !== "JSXAttribute") return null;
  const value = prop.value?.type === "JSXExpressionContainer" ? prop.value.expression : prop.value;
  return value?.type === "StringLiteral" || value?.type === "NumericLiteral" ? value.value : null;
}

export function inspectComposition(project: VirtualProject, compositionFile: string, compositionId: string) {
  const registrationFile = findProjectFile({ project, filePath: compositionFile });
  const registration = parse(project.files[registrationFile]!, { sourceType: "module", plugins: ["typescript", "jsx"] });
  let durationInFrames = 0;
  let fps = 0;
  let width = 0;
  let height = 0;
  visit(registration, node => {
    if (node.type !== "JSXElement" || attribute(node, "id") !== compositionId) return;
    durationInFrames = Number(attribute(node, "durationInFrames"));
    fps = Number(attribute(node, "fps"));
    width = Number(attribute(node, "width"));
    height = Number(attribute(node, "height"));
  });
  if (!fps || !durationInFrames) throw new Error("当前合成使用动态时长，暂不能安全自动编辑，请先设置固定帧率和时长。");
  const captions: StudioCaption[] = [];
  const resolved = resolveCompositionComponentInProject({ project, compositionFile, compositionId });
  const walk = (node: Node, file: string, offset: number, limit: number, ancestry: Set<string>) => {
    if (node.type === "JSXFragment") {
      for (const child of node.children) walk(child, file, offset, limit, ancestry);
      return;
    }
    if (node.type !== "JSXElement") return;
    const tag = node.openingElement.name;
    if (tag.type !== "JSXIdentifier") return;
    const isSequence = tag.name === "Sequence";
    const from = offset + (isSequence ? Number(attribute(node, "from") ?? 0) : 0);
    const frames = isSequence ? attribute(node, "durationInFrames") : null;
    const end = typeof frames === "number" ? Math.min(limit, from + frames) : limit;
    if (isSequence && attribute(node, "name") === "字幕") {
      const text: string[] = [];
      const readText = (child: Node) => {
        if (child.type === "JSXText" && child.value.trim()) text.push(child.value.trim());
        if (child.type === "JSXExpressionContainer" && child.expression.type === "StringLiteral") text.push(child.expression.value);
        if (child.type === "JSXElement" || child.type === "JSXFragment") child.children.forEach(readText);
      };
      node.children.forEach(readText);
      if (text.length && end > Math.max(0, from)) captions.push({ text: text.join(""), startMs: Math.round(Math.max(0, from) / fps * 1000), endMs: Math.round(end / fps * 1000) });
      return;
    }
    const ast = parse(project.files[file]!, { sourceType: "module", plugins: ["typescript", "jsx"] });
    const native = nativeCaptions(node, ast, from, end, fps);
    if (native) { captions.push(...native); return; }
    const imported = ast.program.body.find(statement => statement.type === "ImportDeclaration" && statement.specifiers.some(specifier => specifier.local.name === tag.name));
    const localComponent = /^[A-Z]/.test(tag.name) && !["Sequence", "AbsoluteFill", "Fragment"].includes(tag.name)
      && (!imported || imported.type === "ImportDeclaration" && imported.source.value.startsWith("."));
    if (localComponent) {
      const key = `${file}:${tag.name}`;
      if (ancestry.has(key) || ancestry.size >= 32) throw new Error("字幕组件包含循环引用，无法安全读取当前时间线。");
      // Resolve the rendered symbol only; scanning its whole file leaks sibling compositions.
      const inspectionId = "__loomic_caption_inspection__";
      const source = `${project.files[file]}\nconst __loomicInspection = <Composition id="${inspectionId}" component={${tag.name}} />;`;
      const child = resolveCompositionComponentInProject({ project: { ...project, files: { ...project.files, [file]: source } }, compositionFile: file, compositionId: inspectionId });
      walk(child.root, child.filePath, from, end, new Set([...ancestry, key]));
    }
    for (const child of node.children) walk(child, file, from, end, ancestry);
  };
  walk(resolved.root, resolved.filePath, 0, durationInFrames, new Set());
  return { duration: durationInFrames / fps, fps, format: width < height ? "portrait" as const : "landscape" as const, captions };
}

export async function prepareStudioEdit(project: EditedProject, compositionFile: string, edit: StudioEdit): Promise<EditedProject> {
  if (project.loomicAppliedEdits?.includes(edit.id)) return project;
  if (await projectFingerprint(project, edit.compositionId) !== edit.revision) throw new Error("合成或素材已改变，请重新生成计划。");
  const resolved = resolveCompositionComponentInProject({ project, compositionFile, compositionId: edit.compositionId });
  const { start, end } = resolved.root;
  if (start == null || end == null) throw new Error("无法定位当前合成的可编辑内容。");
  const suffix = edit.id.replaceAll("-", "");
  if (!/^[a-f0-9]{32}$/.test(suffix)) throw new Error("编辑计划标识无效。");
  const component = `LoomicAi${suffix}`;
  const folder = resolved.filePath.slice(0, resolved.filePath.lastIndexOf("/"));
  const modulePath = `${folder}/${component}.tsx`;
  if (project.files[modulePath]) throw new Error("编辑文件已存在，请重新生成计划。");
  const original = resolved.source.slice(start, end);
  const replacement = edit.replaceVideo || resolved.root.type === "NullLiteral" ? `<${component} />` : `<>${original}<${component} /></>`;
  const fps = edit.replaceVideo ? STUDIO_FPS : inspectComposition(project, compositionFile, edit.compositionId).fps;
  const moduleSource = studioCutSource(edit.cut, { layersOnly: !edit.replaceVideo, fps });
  const files = { ...project.files, [modulePath]: moduleSource,
    [resolved.filePath]: `import {LoomicCut as ${component}} from "./${component}";\n${resolved.source.slice(0, start)}${replacement}${resolved.source.slice(end)}` };
  let next: EditedProject = { ...project, files, loomicAppliedEdits: [...(project.loomicAppliedEdits ?? []), edit.id].slice(-500) };
  if (edit.replaceVideo) {
    const metadata = updateCompositionMetadata({ project: next, compositionFile, compositionId: edit.compositionId,
      metadata: { fps: STUDIO_FPS, durationInFrames: cutFrames(edit.cut), width: edit.cut.format === "portrait" ? 720 : 1280, height: edit.cut.format === "portrait" ? 1280 : 720 } });
    next = applyCodemodChanges(next, metadata.changes);
  }
  const prior = project.loomicCuts?.[edit.compositionId];
  const exportable = edit.replaceVideo || prior?.revision === edit.revision;
  next.loomicCuts = { ...next.loomicCuts };
  if (exportable) next.loomicCuts[edit.compositionId] = { revision: await projectFingerprint(next, edit.compositionId), cut: edit.replaceVideo ? edit.cut : { ...edit.cut, captions: [...(prior?.cut.captions ?? []), ...(edit.cut.captions ?? [])], audio: [...(prior?.cut.audio ?? []), ...(edit.cut.audio ?? [])] } };
  else delete next.loomicCuts[edit.compositionId];
  return next;
}
