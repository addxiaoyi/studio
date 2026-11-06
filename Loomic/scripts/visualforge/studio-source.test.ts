import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { patchStudioEnvironment, patchStudioSource } from "./studio-source";

const studioRoot = resolve(import.meta.dir, "../../vendor/visualforge/packages/studio/src");
const read = (file: string) => readFileSync(resolve(studioRoot, file), "utf8");

describe("pinned Studio typography adapter", () => {
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
      "helpers/use-breakpoint.ts",
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
