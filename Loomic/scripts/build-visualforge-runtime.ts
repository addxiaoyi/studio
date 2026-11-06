import { existsSync, readFileSync, readdirSync, mkdirSync, cpSync } from "node:fs";
import { resolve, dirname, relative, isAbsolute, join } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { BunPlugin } from "bun";
import { patchStudioEnvironment, patchStudioSource } from "./visualforge/studio-source";
import { registerPinnedSourceResolver } from "./visualforge/source-resolver";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const lock = JSON.parse(readFileSync(resolve(root, "scripts/creative-sources.json"), "utf8")).video;
const source = resolve(root, lock.directory);
if (execFileSync("git", ["-C", source, "rev-parse", "HEAD"], { encoding: "utf8" }).trim() !== lock.commit) throw new Error("VisualForge source differs from the lock.");
const outdir = resolve(root, "apps/web/public/creative/visualforge");
mkdirSync(outdir, { recursive: true });
const catalog = JSON.parse(readFileSync(join(source, "package.json"), "utf8")).workspaces.catalog;
const packages = new Map<string, { directory: string; manifest: any }>();
for (const name of readdirSync(join(source, "packages"))) {
  const directory = join(source, "packages", name);
  if (!existsSync(join(directory, "package.json"))) continue;
  const manifest = JSON.parse(readFileSync(join(directory, "package.json"), "utf8"));
  if (manifest.name) packages.set(manifest.name, { directory, manifest });
}
const dependencyVersions = { ...catalog, ...Object.fromEntries([...packages].map(([name, pkg]) => [name, pkg.manifest.version])), "react-refresh": "0.18.0" };
const workspaceExports = Object.fromEntries([...packages].filter(([name]) => name.startsWith("@remotion/") || name === "remotion").map(([name, pkg]) => [name, {packageRoot: relative(source, pkg.directory).replaceAll("\\", "/"), exports: Object.fromEntries(Object.entries(pkg.manifest.exports || {}).map(([key, value]: [string, any]) => [key, typeof value === "string" ? value : value.module || value.import || value.default]))}]));
const plugin: BunPlugin = { name: "pinned-visualforge-source", setup(build) {
  build.onLoad({ filter: /[\\/]browser-studio[\\/]src[\\/]browser-studio-operations\.ts$/ }, args => {
    const adapter = resolve(root, "scripts/visualforge/ai-mutation.ts").replaceAll("\\", "/");
    const sourceText = readFileSync(args.path, "utf8").replaceAll("\r\n", "\n");
    const marker = "\n\treturn {\n\t\taddComposition,";
    if (!sourceText.includes(marker)) throw new Error("Pinned Studio mutation entry changed.");
    const extension = `\n\treturn {\n\t\tasync loomicSnapshot(compositionId) {\n\t\t\tconst project = getProject();\n\t\t\tconst compositionFile = getCompositionFile({compositionId, project});\n\t\t\tif (!compositionFile) throw new Error('请选择当前合成。');\n\t\t\treturn {...inspectComposition(project, compositionFile, compositionId), revision: await projectFingerprint(project, compositionId), compositionId};\n\t\t},\n\t\tasync loomicApplyEdit(edit) {\n\t\t\tconst original = getProject();\n\t\t\tconst compositionFile = getCompositionFile({compositionId: edit.compositionId, project: original});\n\t\t\tif (!compositionFile) throw new Error('当前合成已不存在。');\n\t\t\tconst next = await prepareStudioEdit(original, compositionFile, edit);\n\t\t\tif (next === original) return;\n\t\t\tif (getProject() !== original) throw new Error('合成已改变，请重新生成计划。');\n\t\t\tcontroller.applyMutation({fileName: compositionFile, mutate: () => next, nodePathMutationFiles: null, timelineSelection: null, undoRedoNavigation: null});\n\t\t},\n\t\taddComposition,`;
    return { contents: `import {prepareStudioEdit, inspectComposition, projectFingerprint} from ${JSON.stringify(adapter)};\n${sourceText.replace(marker, extension)}`, loader: "ts" };
  });
  build.onResolve({filter:/^fflate$/}, () => ({path: join(source,"packages/browser-studio/node_modules/fflate/esm/browser.js")}));
  registerPinnedSourceResolver(build, source);
  build.onLoad({ filter: /[\\/]BrowserStudio\.tsx$/ }, async args => {
    let contents = readFileSync(args.path, "utf8").replaceAll("\r\n", "\n");
    contents = contents.replace("fontFamily: 'Arial, Helvetica, sans-serif'", "fontFamily: 'inherit'");
    const beforeUnloadEffect = `\n\tuseEffect(() => {\n\t\tconst onBeforeUnload = (event: BeforeUnloadEvent) => {\n\t\t\tevent.preventDefault();\n\t\t\tevent.returnValue = true;\n\t\t};\n\n\t\twindow.addEventListener('beforeunload', onBeforeUnload);\n\t\treturn () => {\n\t\t\twindow.removeEventListener('beforeunload', onBeforeUnload);\n\t\t};\n\t}, []);\n`;
    if (!contents.includes(beforeUnloadEffect)) throw new Error("BrowserStudio beforeunload guard changed; review navigation behavior before rebuilding.");
    contents = contents.replace(beforeUnloadEffect, "\n");
    contents = `import {installNativeStudio} from ${JSON.stringify(resolve(root, "scripts/visualforge/native-dom.ts"))};\n` + contents;
    contents = contents.replace("const iframeRef = useRef<HTMLIFrameElement | null>(null);", "const iframeRef = useRef<HTMLIFrameElement | null>(null);\nconst nativeRef = useRef<HTMLDivElement | null>(null);");
    const start = contents.indexOf("\tuseEffect(() => {\n\t\tif (!iframeHtml)");
    const end = contents.indexOf("\n\treturn (\n\t\t<div style={containerStyle}>", start);
    if (start < 0 || end < 0) throw new Error("BrowserStudio mount changed; update the native integration.");
    contents = contents.slice(0, start) + `
  useEffect(() => {
    if (!iframeHtml || !nativeRef.current) return;
    let disposed = false;
    let dispose;
    void installNativeStudio(nativeRef.current, iframeHtml, browserStudioOperations, hmrAssetManager.bridge, () => window.location.reload()).then(cleanup => { if(disposed) cleanup(); else dispose=cleanup; }).catch(error => { if(!disposed) setState({status:'error',error:{message:error.message}}); });
    return () => {disposed=true;dispose?.();};
  }, [iframeHtml,browserStudioOperations,hmrAssetManager,reloadBrowserStudio]);
` + contents.slice(end);
    contents = contents.replace(/<iframe[\s\S]*?\/>/, '<div ref={nativeRef} className="visualforge-native-root" style={{height:"100%",width:"100%",position:"relative"}} />');
    return { contents, loader: "tsx" };
  });
  build.onLoad({ filter: /[\\/]studio[\\/]src[\\/]helpers[\\/]inject-css\.ts$/ }, args => {
    const contents = readFileSync(args.path,"utf8").replace("Internals.CSSUtils.injectCSS(makeDefaultGlobalCSS());", "Internals.CSSUtils.injectCSS('@scope (.visualforge-native-root) {' + makeDefaultGlobalCSS() + '}');");
    return {contents,loader:"ts"};
  });
  build.onLoad({ filter: /[\\/]core[\\/]src[\\/]default-css\.ts$/ }, args => ({ contents: readFileSync(args.path,"utf8").replace("if (!scope) {", "scope ??= '.visualforge-native-root';\n\tif (!scope) {"), loader:"ts" }));
  build.onLoad({ filter: /[\\/]opfs-public-files\.ts$/ }, args => ({ contents: readFileSync(args.path,"utf8")
    .replace("abandonedProjectSweep ??= sweepAbandonedBrowserStudioProjectStorages();", "abandonedProjectSweep ??= Promise.resolve();")
    .replace("removeBrowserStudioProjectStorage({", "releaseBrowserStudioProjectStorageLease({"), loader:"ts" }));
  build.onLoad({ filter: /[\\/]studio[\\/]src[\\/]previewEntry\.tsx$/ }, args => ({ contents: readFileSync(args.path,"utf8") + "\nwindow.loomicDisposeStudio = () => { root?.unmount(); root = null; };\n", loader:"tsx" }));
  build.onLoad({ filter: /[\\/]ClientRenderQueueProcessor\.tsx$/ }, args => ({ contents: readFileSync(args.path,"utf8").replace("downloadBlob(blob, job.outName);", "void window.loomicSaveStudioExport?.({id:job.id,name:job.outName,blob,createdAt:Date.now()});\n\t\t\t\t\tdownloadBlob(blob, job.outName);"), loader:"tsx" }));
  build.onLoad({ filter: /[\\/]client-render-queue\.ts$/ }, args => ({
    contents: readFileSync(args.path, "utf8").replace(/return `client-\$\{Date\.now\(\)\}-\$\{Math\.random\(\)\.toString\(36\)\.substring\(2, 11\)\}`;/, "return crypto.randomUUID();"),
    loader: "ts",
  }));
  build.onLoad({ filter: /[\\/]studio[\\/]src[\\/].*\.[tj]sx?$/ }, args => ({
    contents: patchStudioSource(relative(join(source, "packages/studio/src"), args.path).replaceAll("\\", "/"), readFileSync(args.path, "utf8")),
    loader: args.path.endsWith("tsx") ? "tsx" : "ts",
  }));
} };
const refreshRuntime = Bun.resolveSync("@rspack/plugin-react-refresh/react-refresh", join(source, "packages/browser-bundler"));
const define = {
  "process.env.NODE_ENV": JSON.stringify("development"),
  __BROWSER_STUDIO_ASSET_SIZES__: JSON.stringify({rspackWasm:0,vendorBundle:0}),
  __BROWSER_STUDIO_DEPENDENCY_VERSIONS__: JSON.stringify(dependencyVersions),
  __BROWSER_STUDIO_SETUP_ENVIRONMENT__: JSON.stringify(patchStudioEnvironment(readFileSync(join(source,"packages/bundler/src/setup-environment.ts"),"utf8"))),
  __BROWSER_STUDIO_WORKSPACE_PACKAGE_EXPORTS__: JSON.stringify(workspaceExports),
  __BROWSER_BUNDLER_REACT_REFRESH_FILES__: JSON.stringify({
    entry: readFileSync(Bun.resolveSync("@rspack/plugin-react-refresh/react-refresh-entry", join(source, "packages/browser-bundler")), "utf8"),
    runtime: readFileSync(refreshRuntime, "utf8"),
    utils: readFileSync(join(dirname(refreshRuntime), "refreshUtils.js"), "utf8"),
  }),
  __BROWSER_BUNDLER_DEPENDENCY_VERSIONS__: JSON.stringify({ react: catalog.react, "react-dom": catalog["react-dom"], remotion: packages.get("remotion")!.manifest.version }),
};
const entries = [resolve(root,"scripts/visualforge/entry.tsx"),join(source,"packages/browser-studio/src/browser-studio-worker.ts"),join(source,"packages/browser-studio/src/browser-studio-vendor-entry.ts"),join(source,"packages/browser-studio/src/browser-studio-transformers-entry.ts")];
for (const entry of entries) {
  const output = await Bun.build({ entrypoints:[entry], outdir, naming:"[name].mjs",target:"browser",format:"esm",minify:true,plugins:[plugin],define,external:entry.includes("transformers-entry") ? [] : ["@huggingface/transformers"] });
  if (!output.success) throw new AggregateError(output.logs, `VisualForge build failed: ${entry}`);
  console.log(`${entry.split(/[\\/]/).pop()}: ${output.outputs.reduce((sum,file)=>sum+file.size,0)} bytes`);
}
const rspackDir = join(source,"packages/browser-studio/node_modules/@rspack/browser/dist");
cpSync(join(rspackDir,"rspack.wasm32-wasi.wasm"),join(outdir,"rspack.wasm32-wasi.wasm"));
const wasi = await Bun.build({entrypoints:[join(rspackDir,"wasi-worker-browser.mjs")],outdir,naming:"[name].mjs",target:"browser",format:"iife",minify:true});
if(!wasi.success)throw new AggregateError(wasi.logs,"VisualForge WASI worker build failed");
cpSync(join(source,"LICENSE.md"),join(outdir,"LICENSE.md"));
await Bun.write(join(outdir,"source.json"),JSON.stringify(lock,null,2));
