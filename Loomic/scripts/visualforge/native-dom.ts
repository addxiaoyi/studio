/** Mount the pinned Studio source into the workspace, without a nested website. */
export async function installNativeStudio(container: HTMLElement, html: string, operations: unknown, hmr: unknown, reload: () => void) {
  const parsed = new DOMParser().parseFromString(html, "text/html");
  const globals = window as unknown as Record<string, unknown>;
  for (const script of parsed.querySelectorAll("script:not([src])")) {
    const assignment = script.textContent?.trim().match(/^window\.(remotion_[A-Za-z0-9_]+)\s*=\s*([\s\S]*?);?$/);
    if (!assignment || assignment[2]!.includes("window.")) continue;
    const literal = assignment[2]!.replace(/;$/, "");
    try { globals[assignment[1]!] = JSON.parse(literal); }
    catch { throw new Error(`VisualForge configuration is not a JSON literal: ${assignment[1]}`); }
  }
  globals.siteVersion = "11";
  globals.remotion_version = "4.0.538";
  globals.remotion_sampleRate = 48000;
  globals.remotion_browserStudio = operations;
  globals.remotion_browserStudioHmr = hmr;
  globals.remotion_browserStudioReload = reload;
  globals.remotion_showBrowserStudioExperimentalNotice = false;
  globals.remotion_saasMode = true;
  if (!document.getElementById('__remotion_favicon')) {
    const icon = document.createElement('link');
    icon.id = '__remotion_favicon';
    icon.rel = 'icon';
    icon.href = '/favicon.ico';
    container.append(icon);
  }
  const roots = [...parsed.body.children].filter(node => node.tagName === "DIV" && node.id);
  const icon = document.getElementById('__remotion_favicon');
  container.replaceChildren(...(icon ? [icon] : []), ...roots.map(node => document.importNode(node, true)));
  const script = parsed.querySelector<HTMLScriptElement>("script[src]");
  if (!script?.src.startsWith("blob:")) throw new Error("VisualForge compiler returned an invalid bundle.");
  const importMap = parsed.querySelector('script[type="importmap"]');
  if (importMap && !document.querySelector('script[data-visualforge-imports]')) {
    const node = document.createElement("script"); node.type = "importmap"; node.dataset.visualforgeImports = "true"; node.textContent = importMap.textContent; document.head.append(node);
  }
  await import(/* webpackIgnore: true */ script.src);
  window.dispatchEvent(new Event("remotion-browser-studio-operations-ready"));
  const dispose = globals.loomicDisposeStudio;
  return () => {
    if (typeof dispose === 'function') dispose();
    if (globals.loomicDisposeStudio === dispose) delete globals.loomicDisposeStudio;
  };
}
