import { parse } from "../../vendor/visualforge/packages/codemods/node_modules/@babel/parser";
import type { Node, JSXElement } from "../../vendor/visualforge/packages/codemods/node_modules/@babel/types";
import { resolveCompositionComponentInProject } from "../../vendor/visualforge/packages/codemods/src/resolve-composition-component-location";
import { applyCodemodChanges } from "../../vendor/visualforge/packages/codemods/src/codemod-project";
import { updateCompositionMetadata } from "../../vendor/visualforge/packages/codemods/src/update-composition-metadata";
import { findProjectFile } from "../../vendor/visualforge/packages/codemods/src/internals";
import type { VirtualProject } from "../../vendor/visualforge/packages/browser-studio/src/types";
import { studioCutSource, cutFrames, STUDIO_FPS, type StudioCut, type StudioCaption } from "../../apps/web/src/lib/studio-cut";
import { nativeCaptions } from "./native-captions";
import { actionCut } from "../../apps/web/src/lib/studio-action-cut";
import { inspectLayers, changeLayers } from "./native-layers";
import { animateLayers, motionFiles } from "./native-motion";
import type { StudioEdit, StudioUndo, StudioEditReceipt } from "../../apps/web/src/lib/visualforge-runtime";
export type { StudioEdit } from "../../apps/web/src/lib/visualforge-runtime";

type EditJournal = { edit: StudioEdit; revision: string; undone: number[]; baseFiles: Record<string, string | null>; baseCut: { revision: string; cut: StudioCut } | null; duration: number; format: StudioCut["format"] };
type EditedProject = VirtualProject & { loomicAppliedEdits?: string[]; loomicCuts?: Record<string, { revision: string; cut: StudioCut }>; loomicEditJournals?: Record<string, EditJournal> };

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
    if(tag.name==="LoomicMotion"){node.children.forEach(child=>walk(child,file,offset,limit,ancestry));return;}
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
  return { duration: durationInFrames / fps, fps, width, height, format: width < height ? "portrait" as const : "landscape" as const, captions,
    layers: inspectLayers(project,compositionFile,compositionId,fps,durationInFrames/fps) };
}

async function applyLegacyEdit(project: EditedProject, compositionFile: string, edit: StudioEdit): Promise<EditedProject> {
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
  if (exportable) next.loomicCuts[edit.compositionId] = { revision: await projectFingerprint(next, edit.compositionId), cut: edit.replaceVideo ? edit.cut : { ...prior!.cut, captions: [...(prior?.cut.captions ?? []), ...(edit.cut.captions ?? [])], audio: [...(prior?.cut.audio ?? []), ...(edit.cut.audio ?? [])],images:[...(prior?.cut.images??[]),...(edit.cut.images??[])] } };
  else delete next.loomicCuts[edit.compositionId];
  return next;
}

async function applyStudioEdit(project: EditedProject, compositionFile: string, edit: StudioEdit): Promise<EditedProject> {
  if(!edit.commands)return applyLegacyEdit(project,compositionFile,edit);
  if(project.loomicAppliedEdits?.includes(edit.id))return project;
  if(await projectFingerprint(project,edit.compositionId)!==edit.revision)throw new Error("合成或素材已改变，请重新预览。");
  const before=inspectComposition(project,compositionFile,edit.compositionId);
  const changes=edit.commands.filter(action=>action.type==="layer");
  const motion=edit.commands.filter(action=>action.type==="keyframes");
  let next:EditedProject=animateLayers(project,compositionFile,edit.compositionId,before.fps,before.duration,motion);
  next=changeLayers(next,compositionFile,edit.compositionId,before.fps,before.duration,changes);
  if(edit.commands.some(action=>["cut","caption","audio","transition","image"].includes(action.type))){
    if(edit.cut.transitions?.length)next={...next,files:{...next.files,...motionFiles()}};
    next=await applyLegacyEdit(next,compositionFile,{...edit,revision:await projectFingerprint(next,edit.compositionId)});
  }
  const resize=edit.commands.find(action=>action.type==="resize");
  if(resize)next=applyCodemodChanges(next,updateCompositionMetadata({project:next,compositionFile,compositionId:edit.compositionId,metadata:{width:resize.width,height:resize.height}}).changes);
  if(changes.length||resize||motion.length){next={...next,loomicCuts:{...next.loomicCuts}};delete next.loomicCuts![edit.compositionId];}
  if(!next.loomicAppliedEdits?.includes(edit.id))next={...next,loomicAppliedEdits:[...(next.loomicAppliedEdits??[]),edit.id].slice(-500)};
  return next;
}

export async function prepareStudioEdit(project: EditedProject, compositionFile: string, edit: StudioEdit): Promise<EditedProject> {
  if (project.loomicAppliedEdits?.includes(edit.id)) return project;
  const before = inspectComposition(project, compositionFile, edit.compositionId);
  const approved = edit.commands ? { ...edit, ...actionCut(edit.commands, {...before,cut:project.loomicCuts?.[edit.compositionId]?.cut}) } : edit;
  const next = await applyStudioEdit(project, compositionFile, approved);
  if (!edit.commands) return next;
  const baseFiles: Record<string, string | null> = {};
  for (const name of new Set([...Object.keys(project.files), ...Object.keys(next.files)])) {
    if (project.files[name] !== next.files[name]) baseFiles[name] = project.files[name] ?? null;
  }
  const journal: EditJournal = { edit: structuredClone(approved), revision: await projectFingerprint(next, edit.compositionId), undone: [], baseFiles,
    baseCut: structuredClone(project.loomicCuts?.[edit.compositionId] ?? null), duration: before.duration, format: before.format };
  const retained = Object.entries(project.loomicEditJournals ?? {}).slice(-19);
  return { ...next, loomicEditJournals: { ...Object.fromEntries(retained), [edit.id]: journal } };
}

export async function inspectEditReceipt(project: EditedProject, compositionId: string): Promise<StudioEditReceipt | undefined> {
  const id = project.loomicAppliedEdits?.at(-1);
  const journal = id ? project.loomicEditJournals?.[id] : undefined;
  if (!id || !journal || journal.edit.compositionId !== compositionId) return undefined;
  const actions = journal.edit.commands ?? [];
  const complete = actions.every((action, index) => action.type === "export" || journal.undone.includes(index));
  return { id, revision: journal.revision, originalRevision: journal.edit.revision, undone: journal.undone, complete,
    canUndo: !complete && await projectFingerprint(project, compositionId) === journal.revision };
}

export async function prepareStudioUndo(project: EditedProject, compositionFile: string, input: StudioUndo): Promise<EditedProject> {
  const journal = project.loomicEditJournals?.[input.id];
  if (!journal?.edit.commands || journal.edit.compositionId !== input.compositionId) throw new Error("此方案没有可恢复的动作记录。");
  const actual = await projectFingerprint(project, input.compositionId);
  if (actual !== input.revision || actual !== journal.revision || project.loomicAppliedEdits?.at(-1) !== input.id) throw new Error("视频已有后续修改，不能覆盖；请先撤销后续修改。");
  const actions = journal.edit.commands;
  if (input.actionIndex !== undefined && (!Number.isInteger(input.actionIndex) || !actions[input.actionIndex] || actions[input.actionIndex]?.type === "export")) throw new Error("此动作不能撤销，已导出的文件会保留。");
  const indexes = input.actionIndex === undefined ? actions.flatMap((action, index) => action.type === "export" ? [] : [index]) : [input.actionIndex];
  if (indexes.every(index => journal.undone.includes(index))) return project;
  const undone = [...new Set([...journal.undone, ...indexes])].sort((a, b) => a - b);
  const remaining = actions.filter((action, index) => action.type !== "export" && !undone.includes(index));
  if (!remaining.some(action => action.type === "cut") && remaining.some(action => action.type === "caption" ? action.endMs > journal.duration * 1000 : action.type === "audio" && action.startMs >= journal.duration * 1000)) {
    throw new Error("请先撤销超出原视频时长的字幕或配乐，再撤销剪辑。");
  }
  const files = { ...project.files };
  for (const [path, content] of Object.entries(journal.baseFiles)) { if (content === null) delete files[path];else files[path] = content; }
  const cuts = { ...project.loomicCuts };
  if (journal.baseCut) cuts[input.compositionId] = journal.baseCut;else delete cuts[input.compositionId];
  const base: EditedProject = { ...project, files, loomicCuts: cuts, loomicAppliedEdits: project.loomicAppliedEdits?.filter(id => id !== input.id) };
  if (await projectFingerprint(base, input.compositionId) !== journal.edit.revision) throw new Error("原视频恢复记录不完整，无法安全撤销。");
  let next = remaining.length ? await applyStudioEdit(base, compositionFile, { ...journal.edit, commands: remaining, ...actionCut(remaining, { duration: journal.duration, format: journal.format,cut:journal.baseCut?.cut }) }) : base;
  // Keep the consumed edit marker even after full undo so a lost receipt cannot replay it.
  next = { ...next, loomicAppliedEdits: project.loomicAppliedEdits };
  return { ...next, loomicEditJournals: { ...project.loomicEditJournals, [input.id]: { ...journal, undone, revision: await projectFingerprint(next, input.compositionId) } } };
}
