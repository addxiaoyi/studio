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
  if (file === "components/Timeline/get-copy-context-for-agents-menu-item.ts") {
    addBridge();replace("copyText(\n", "sendStudioContext(\n");
    text = text.replaceAll("Could not copy to clipboard:", "Could not open Loomic AI:");
  }
  text = text.replaceAll("Copy context for agents", "Send context to Loomic AI")
    .replaceAll("Annotate with ChatGPT", "Discuss in Loomic AI")
    .replaceAll("Send to ChatGPT", "Send to Loomic AI");
  return text;
}
