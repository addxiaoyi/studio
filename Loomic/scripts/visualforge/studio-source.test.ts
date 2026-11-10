import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { patchStudioEnvironment, patchStudioSource } from "./studio-source";
import {translateStudioValue} from "./studio-i18n";

const studioRoot = resolve(import.meta.dir, "../../vendor/visualforge/packages/studio/src");
const read = (file: string) => readFileSync(resolve(studioRoot, file), "utf8");

describe("pinned Studio typography adapter", () => {
  test("uses Helstera in the browser title",()=>{
    const title=patchStudioSource("helpers/document-title.ts",read("helpers/document-title.ts"));expect(title).toContain("const productName = 'Helstera 视频创作';");expect(title).not.toContain("VisualForge Studio");
  });
  test("localizes the composition menu and ruler labels without renaming user compositions",()=>{
    expect(translateStudioValue("Composition")).toBe("合成");expect(translateStudioValue("Horizontal ruler")).toBe("水平标尺");expect(translateStudioValue("Vertical ruler")).toBe("垂直标尺");expect(translateStudioValue("Loading Studio")).toBe("正在加载编辑器");expect(translateStudioValue("MyComp")).toBe("MyComp");
  });
  test("removes the brand menu and routes agent actions through Loomic", () => {
    const menu = patchStudioSource("helpers/use-menu-structure.tsx", read("helpers/use-menu-structure.tsx"));
    expect(menu).toContain("struct = struct.filter(menu => menu.id !== 'remotion')");
    expect(menu).toContain("label: t('Menu')");
    const context = patchStudioSource("components/composition-menu-items.ts", read("components/composition-menu-items.ts"));
    expect(context).toContain("sendStudioContext(contextForAgents, composition?.id)");
    expect(context).not.toContain("copyText(contextForAgents)");
    const annotation = patchStudioSource("helpers/get-codex-annotation.ts", read("helpers/get-codex-annotation.ts"));
    expect(annotation).not.toContain(".oai");
    expect(annotation).toContain("requestStudioAnnotation");
    const ask = patchStudioSource("components/AskAiModal.tsx", read("components/AskAiModal.tsx"));
    expect(ask).not.toContain("<iframe");
    expect(ask).toContain("sendStudioContext");
  });

  test("exposes one AI action and one working export instead of developer handoffs", () => {
    const source = patchStudioSource("components/composition-menu-items.ts", read("components/composition-menu-items.ts"));
    expect(source).toContain("creatorCompositionMenu");
    const menu = patchStudioSource("helpers/use-menu-structure.tsx", read("helpers/use-menu-structure.tsx"));
    expect(menu).toContain("openStudioExport()");
    expect(menu).not.toContain("renderButton.click()");
    const inspector = patchStudioSource("components/InspectorLocationCopy.tsx", read("components/InspectorLocationCopy.tsx"));
    expect(inspector).not.toContain("{children}");
    expect(inspector).not.toContain("<InspectorOpenInEditor");
  });
  test("leaves generic menu labels and user enum values untouched", () => {
    const file = "components/NewComposition/MenuContent.tsx";
    const source = read(file);
    expect(patchStudioSource(file, source)).toBe(source.replaceAll("\r\n", "\n"));
  });

  test("menu memoization depends on the active translator", () => {
    for (const [file, variable, expected] of [
      ["components/ToolbarMenuItems.tsx", "menu", 2],
      ["components/PreviewViewOptionsDropdown.tsx", "values", 1],
      ["helpers/use-menu-structure.tsx", "structure", 1],
    ] as const) {
      const source = ts.createSourceFile(file, patchStudioSource(file, read(file)), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      let count = 0;
      const visit = (node: ts.Node) => {
        if (ts.isVariableDeclaration(node) && node.name.getText(source) === variable && node.initializer && ts.isCallExpression(node.initializer)) {
          const dependencies = node.initializer.arguments[1];
          if (dependencies && ts.isArrayLiteralExpression(dependencies)) {
            expect(dependencies.elements.map(item => item.getText(source))).toContain("t");
            count += 1;
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
      expect(count).toBe(expected);
    }
  });

  test("accepts LF and CRLF pinned sources and emits valid TSX", () => {
    for (const file of [
      "components/ToolbarMenuItems.tsx", "helpers/use-menu-structure.tsx",
      "components/PreviewViewOptionsDropdown.tsx", "components/StudioSettings.tsx",
      "components/OptionsPanel.tsx", "components/QuickSwitcher/ExplorerQuickSwitcherTrigger.tsx",
      "components/InspectorPanel/CollapsibleInspectorSectionHeader.tsx",
      "components/Timeline/TimelineFieldLabel.tsx", "components/InspectorPanel/common.tsx",
      "components/RenderButton.tsx", "i18n/locales/zh-CN.ts",
      "components/ModalContainer.tsx", "i18n/index.tsx",
      "components/ModalHeader.tsx", "components/Tabs/vertical.tsx",
      "components/RenderModal/WebRenderModal.tsx", "components/RenderModal/WebRenderModalBasic.tsx",
      "components/RenderModal/WebRenderModalPicture.tsx", "components/RenderModal/WebRenderModalAdvanced.tsx",
      "components/RenderModal/WebRenderModalAudio.tsx", "components/RenderModal/RenderModalOutputName.tsx",
      "helpers/use-breakpoint.ts",
      "components/Menu/portals.ts",
      "components/composition-menu-items.ts", "components/folder-menu-items.ts", "components/InspectorLocationCopy.tsx",
      "components/Timeline/get-copy-context-for-agents-menu-item.ts", "components/get-annotate-with-chatgpt-menu-item.ts",
      "helpers/get-codex-annotation.ts", "components/AskAiModal.tsx",
      "components/MenuBuildIndicator.tsx",
      "components/Timeline/TimelineSequenceName.tsx", "components/Timeline/TimelineMediaInfo.tsx",
      "components/RenderQueue/RenderQueueItemStatus.tsx",
    ]) {
      const lf = read(file).replaceAll("\r\n", "\n");
      const patched = patchStudioSource(file, lf);
      expect(patchStudioSource(file, lf.replaceAll("\n", "\r\n"))).toBe(patched);
      const compiled = ts.transpileModule(patched, { fileName: file, reportDiagnostics: true, compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } });
      expect(compiled.diagnostics).toEqual([]);
    }
  });

  test("rejects changed upstream anchors instead of silently shipping a partial patch", () => {
    expect(() => patchStudioSource("components/ToolbarMenuItems.tsx", "export {};")).toThrow("Pinned Studio integration changed");
    expect(() => patchStudioEnvironment("body { color: white; }")).toThrow("CSS reset was not found");
  });
});
