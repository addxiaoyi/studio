import { resolve } from "node:path";

const bridge = JSON.stringify(resolve(import.meta.dir, "../../apps/web/src/lib/studio-ai-context.ts").replaceAll("\\", "/"));

export function patchStudioAiSource(file: string, source: string) {
  let text = source;
  const replace = (before: string, after: string) => {
    if (!text.includes(before)) throw new Error(`Pinned Studio AI integration changed in ${file}: ${before}`);
    text = text.replaceAll(before, after);
  };
  const addBridge = () => { text = `import {sendStudioContext} from ${bridge};\n${text}`; };
  if (file === "helpers/use-menu-structure.tsx") {
    text = `import {openStudioExport} from ${bridge};\n${text}`;
    const start = text.indexOf("export const getRenderMenuItems = (");
    const end = text.indexOf("export const useCurrentCompositionMenuData =");
    if (start < 0 || end < start) throw new Error("Pinned export menu boundary changed.");
    text = text.slice(0, start) + `export const getRenderMenuItems = ({t,closeMenu,compositionSelected,renderShortcut}: {t:(key:string)=>string;closeMenu:()=>void;compositionSelected:boolean;renderShortcut:string;previewServerState:string;readOnlyStudio:boolean}): ComboboxValue[] => [{id:'render-on-web',value:'render-on-web',label:t('Export video...'),onClick:()=>{closeMenu();try{openStudioExport();}catch(error){showNotification((error as Error).message,3000);}},type:'item',keyHint:renderShortcut||null,leftItem:null,subMenu:null,quickSwitcherLabel:t('Export video...'),disabled:!compositionSelected},{type:'divider',id:'render-divider'}];\n\n` + text.slice(end);
    replace("\t\tif (mobileLayout) {\n\t\t\tstruct = [", "\t\tstruct = struct.filter(menu => menu.id !== 'remotion');\n\t\tif (mobileLayout) {\n\t\t\tstruct = [");
    replace("\t\t\t\t\t...struct[0],", "\t\t\t\t\t...struct[0],\n\t\t\t\t\tlabel: t('Menu'),");
  }
  if (file === "helpers/get-codex-annotation.ts") {
    replace("export const getCodexAnnotation", "export const getCodexAnnotation");
    return `import {requestStudioAnnotation} from ${bridge};\nexport const getCodexAnnotation = () => typeof window !== 'undefined' && window.loomicStudioAi ? {request: requestStudioAnnotation} : null;\n`;
  }
  if (file === "components/AskAiModal.tsx") {
    replace("export const askAiModalRef", "export const askAiModalRef");
    return `import React, {createRef,useImperativeHandle} from 'react';\nimport {sendStudioContext} from ${bridge};\nimport {showNotification} from './Notifications/NotificationCenter';\nexport const askAiModalRef = createRef<{toggle():void}>();\nexport const AskAiModal = () => {useImperativeHandle(askAiModalRef,()=>({toggle:()=>{void sendStudioContext('').catch(error=>showNotification(error.message,3000));}}),[]);return null;};\n`;
  }
  if (file === "components/composition-menu-items.ts" || file === "components/folder-menu-items.ts" || file === "components/InspectorLocationCopy.tsx") {
    addBridge();
    replace("copyText(contextForAgents)", file === "components/composition-menu-items.ts" ? "sendStudioContext(contextForAgents, composition?.id)" : "sendStudioContext(contextForAgents)");
    text = text.replaceAll("Could not copy to clipboard:", "Could not open Loomic AI:");
  }
  if (file === "components/composition-menu-items.ts") {
    text = `import {creatorCompositionMenu} from ${bridge};\n${text}`;
    const suffix = "].filter(NoReactInternals.truthy);\n};\n\nexport const getCompositionContextMenuItems";
    replace(suffix, "].filter(NoReactInternals.truthy);\n\treturn creatorCompositionMenu(items);\n};\n\nexport const getCompositionContextMenuItems");
    const start = text.indexOf("export const getCompositionMenuItems");
    const body = text.indexOf("\n\treturn [", start);
    if (body < 0) throw new Error("Pinned composition menu body changed.");
    text = text.slice(0, body) + text.slice(body).replace("\n\treturn [", "\n\tconst items = [");
  }
  if (file === "components/InspectorLocationCopy.tsx") {
    text = `import {getStaticT} from '../i18n';\n${text}`;
    replace('<div style={content}>{children}</div>', "<div style={content}>{name || getStaticT()('Selected item')}</div>");
    if (!/<InspectorOpenInEditor[\s\S]*?\/>/.test(text)) throw new Error("Pinned inspector link changed.");
    text = text.replace(/<InspectorOpenInEditor[\s\S]*?\/>/, "");
  }
  if (file === "components/InspectorSourceLocation.tsx") {
    // Browser users cannot open a source file; retain developer locations only when actionable.
    replace("if (!label) {", "if (!label || !canOpen) {");
  }
  if (file === "components/MenuBuildIndicator.tsx") {
    text = `import {useTranslation} from '../i18n';\n${text}`;
    replace("const [isBuilding, setIsBuilding]", "const {t}=useTranslation();\n\tconst [isBuilding, setIsBuilding]");
    replace("aria-label={window.remotion_cwd}", "aria-label={t('Current project')}");
    replace("{window.remotion_projectName}", "{window.remotion_projectName === 'template-blank' ? t('Current project') : window.remotion_projectName}");
    if (!/<InspectorOpenInEditor[\s\S]*?\/>/.test(text)) throw new Error("Pinned project link changed.");
    text = text.replace(/<InspectorOpenInEditor[\s\S]*?\/>/, "");
  }
  if (file === "components/Timeline/get-copy-context-for-agents-menu-item.ts") {
    addBridge();replace("copyText(\n", "sendStudioContext(\n");
    text = text.replaceAll("Could not copy to clipboard:", "Could not open Loomic AI:");
  }
  text = text.replaceAll("Copy context for agents", "Send context to Loomic AI")
    .replaceAll("Annotate with ChatGPT", "Discuss in Loomic AI")
    .replaceAll("Send to ChatGPT", "Send to Loomic AI");
  return text;
}
