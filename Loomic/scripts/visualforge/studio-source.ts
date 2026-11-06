import { studioChinese } from "./studio-copy";

const UI_FONT = 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif';

function replaceRequired(source: string, before: string, after: string, file: string) {
  if (!source.includes(before)) throw new Error(`Pinned Studio integration changed in ${file}: ${before}`);
  return source.replaceAll(before, after);
}

export function patchStudioEnvironment(source: string) {
  const reset = / {2}\.css-reset, \.css-reset \* \{[\s\S]*?\n {2}\}/;
  if (!reset.test(source)) throw new Error("Pinned Studio CSS reset was not found");
  return source.replace(reset, `  .visualforge-native-root .css-reset {
    font-size: 13px;
    line-height: 1.5;
    color: var(--remotion-studio-white);
    font-family: ${UI_FONT};
    background: transparent;
    box-sizing: border-box;
  }
  :where(.visualforge-native-root .css-reset *) {
    font-size: inherit;
    line-height: inherit;
    color: inherit;
    font-family: inherit;
    background: transparent;
    box-sizing: border-box;
  }
  .visualforge-native-root {
    --remotion-studio-white-alpha-80: var(--remotion-studio-light-text);
    --remotion-studio-white-alpha-90: var(--remotion-studio-white);
  }`);
}

/** Keep upstream files pinned; adapt UI labels without changing project source or identifiers. */
export function patchStudioSource(file: string, source: string) {
  let text = source.replaceAll("\r\n", "\n");
  const replace = (before: string, after: string) => {
    text = replaceRequired(text, before, after, file);
  };
  if (file === "components/Menu/portals.ts") {
    replace("export const getPortal = (i: number) => {", "export const getPortal = (i: number) => {\n\tconst modal = document.querySelector<HTMLDialogElement>('dialog[open]');\n\tif (modal?.matches(':modal')) {\n\t\tlet layer = modal.querySelector<HTMLDivElement>(`[data-studio-portal=\"${i}\"]`);\n\t\tif (!layer) { layer = document.createElement('div'); layer.dataset.studioPortal = String(i); modal.append(layer); }\n\t\treturn layer;\n\t}");
  }
  if (file === "helpers/use-breakpoint.ts") {
    replace("export function useBreakpoint", "const workspaceWidth = () => document.querySelector('.visualforge-native-root')?.getBoundingClientRect().width || window.innerWidth;\nexport function useBreakpoint");
    replace("window.innerWidth < breakpoint", "workspaceWidth() < breakpoint");
    replace("window.addEventListener('resize', handleResize);", "const root = document.querySelector('.visualforge-native-root'); const observer = new ResizeObserver(handleResize); if (root) observer.observe(root);\n\t\twindow.addEventListener('resize', handleResize);");
    replace("window.removeEventListener('resize', handleResize);", "observer.disconnect(); window.removeEventListener('resize', handleResize);");
  }
  if (file === "components/ModalContainer.tsx") {
    replace("import React, {useCallback}", "import React, {useCallback, useLayoutEffect, useRef}");
    replace("const onPointerDown = useCallback", "const dialog = useRef<HTMLDialogElement>(null);\n\tuseLayoutEffect(() => { const node = dialog.current; if (!node) return; node.showModal(); return () => node.close(); }, []);\n\tconst onPointerDown = useCallback");
    replace("\t\t<div\n\t\t\taria-label", "\t\t<dialog\n\t\t\tref={dialog}\n\t\t\tonCancel={event => { event.preventDefault(); onEscape(); }}\n\t\t\taria-label");
    replace("style={backgroundOverlay}", "style={{...backgroundOverlay, inset: 0, margin: 0, border: 0, maxWidth: 'none', maxHeight: 'none', width: '100vw', height: '100dvh'}}");
    replace("\t\t</div>\n\t);", "\t\t</dialog>\n\t);");
  }
  if (file === "i18n/index.tsx") {
    replace("useMemo, useState", "useMemo, useState, useEffect");
    replace("\tconst value = useMemo(() => ({locale, setLocale}), [locale, setLocale]);", "\tuseEffect(() => { const sync = () => setLocaleState(localStorage.getItem('helstera.locale') === 'en-US' ? 'en' : 'zh-CN'); sync(); window.addEventListener('helstera:locale-changed', sync); return () => window.removeEventListener('helstera:locale-changed', sync); }, []);\n\tconst value = useMemo(() => ({locale, setLocale}), [locale, setLocale]);");
    replace("localStorage.setItem('remotion.locale', next);", "localStorage.setItem('remotion.locale', next); localStorage.setItem('helstera.locale', next === 'en' ? 'en-US' : 'zh-CN'); window.dispatchEvent(new Event('helstera:locale-changed'));");
  }
  text = text.replaceAll("'Arial, Helvetica, sans-serif'", JSON.stringify(UI_FONT))
    .replaceAll("'SF Pro, Arial, Helvetica, sans-serif'", JSON.stringify(UI_FONT));
  if (file === "i18n/locales/zh-CN.ts") {
    return `${text}\nObject.assign(zhCN, ${JSON.stringify(studioChinese)});\n`;
  }
  if (file === "components/ToolbarMenuItems.tsx") {
    replace("label: 'Composition'", "label: t('Composition')");
    replace("...getCompositionMenuItems({", "...getCompositionMenuItems({\n\t\t\t\t\t\tt,");
    replace("\n\t\t\t[\n", "\n\t\t\t[\n\t\t\t\tt,\n");
  }
  if (file === "helpers/use-menu-structure.tsx") {
    replace("...getCompositionMenuItems({", "...getCompositionMenuItems({\n\t\t\t\t\t\t\t\t\tt,");
    replace("\n\t}, [\n\t\treadOnlyStudio,", "\n\t}, [\n\t\tt,\n\t\treadOnlyStudio,");
  }
  if (file === "components/OptionsPanel.tsx") replace("{inspectorTitle}", "{t(inspectorTitle)}");
  if (file === "components/QuickSwitcher/ExplorerQuickSwitcherTrigger.tsx") {
    text = `import {useTranslation} from '../../i18n';\n${text}`;
    replace("const {setSelectedModal}", "const {t} = useTranslation();\n\tconst {setSelectedModal}");
    replace("\n\t\t\t\tSearch...", "\n\t\t\t\t{t('Search...')}");
    replace('label="More actions"', "label={t('More actions')}");
    replace("aria-label={moreActionsTitle}", "aria-label={t(moreActionsTitle)}");
  }
  if (file === "components/PreviewViewOptionsDropdown.tsx") {
    replace("label: 'Outlines'", "label: t('Outlines')");
    replace("label: 'Pixel Grid'", "label: t('Pixel Grid')");
    replace("label: showCompositionControls ? 'Rulers and Guides' : 'Rulers'", "label: t(showCompositionControls ? 'Rulers and Guides' : 'Rulers')");
    replace("\n\t}, [\n", "\n\t}, [\n\t\tt,\n");
  }
  if (file === "components/StudioSettings.tsx") {
    replace("value={locale}", "aria-label=\"Language / 语言\"\n\t\t\t\t\tvalue={locale}");
    replace("color: 'white'", "color: 'var(--remotion-studio-white)'");
    replace("border: '1px solid rgba(255,255,255,0.2)'", "border: '1px solid var(--remotion-studio-white-alpha-20)'");
  }
  if (file === "components/SettingsModal.tsx") {
    text = text.replace("import {isSaasMode} from '../saas-mode';", "import {isSaasMode} from '../saas-mode';\nimport {useTranslation} from '../i18n';");
    replace("const {setSelectedModal} = useContext(SetSelectedModalContext);", "const {t} = useTranslation();\n\tconst {setSelectedModal} = useContext(SetSelectedModalContext);");
    replace('<ModalHeader title="Settings"', '<ModalHeader title={t("Settings")}');
    for (const [english, chinese] of [
      ["Studio", "编辑器"], ["Defaults", "默认设置"], ["Shortcuts", "快捷键"],
      ["Packages", "依赖包"], ["Skills", "技能"], ["Elements", "元素"],
      ["Models", "模型"], ["Apps", "应用"], ["License", "许可证"],
      ["Updates", "更新"],
    ] as const) {
      const tabText = new RegExp(`(>\\s*)${english}(\\s*</VerticalTab>)`);
      if (!tabText.test(text)) throw new Error(`Pinned settings tab changed in ${file}: ${english}`);
      text = text.replace(tabText, `$1{t("${chinese}")}$2`);
    }
  }
  if (file === "components/KeyboardShortcutsSettings.tsx") {
    replace("<p style={shortcutSectionTitle}>{group.name}</p>", "<p style={shortcutSectionTitle}>{t(group.name)}</p>");
    replace("<div role=\"list\" aria-label={group.name}>", "<div role=\"list\" aria-label={t(group.name)}>");
    replace("<span style={actionName}>{shortcut.action}</span>", "<span style={actionName}>{t(shortcut.action)}</span>");
    replace("aria-label={`Change shortcut for ${shortcut.action}`}", "aria-label={`${t('Change shortcut for')} ${t(shortcut.action)}`}");
    replace("aria-label={`Actions for ${shortcut.action}`}", "aria-label={`${t('Actions for')} ${t(shortcut.action)}`}");
    replace("<span style={emptyShortcut}>Press shortcut…</span>", "<span style={emptyShortcut}>{t('Press shortcut...')}</span>");
  }
  if (file === "components/InspectorPanel/CollapsibleInspectorSectionHeader.tsx") {
    text = `import {useTranslation} from '../../i18n';\n${text}`;
    replace("({action, expanded, label, onToggle}) => {", "({action, expanded, label, onToggle}) => {\n\tconst {t} = useTranslation();");
    replace("{label}</", "{t(label)}</");
    replace("${expanded ? 'Collapse' : 'Expand'} ${label}", "${t(expanded ? 'Collapse' : 'Expand')} ${t(label)}");
  }
  if (file === "components/Timeline/TimelineFieldLabel.tsx") {
    text = `import {useTranslation} from '../../i18n';\n${text}`;
    replace("const {basePadding, highlightSelectedLabel}", "const {t} = useTranslation();\n\tconst {basePadding, highlightSelectedLabel}");
    replace("aria-label={label}", "aria-label={t(label)}");
    replace("\n\t\t\t\t{label}", "\n\t\t\t\t{t(label)}");
  }
  if (file === "components/InspectorPanel/common.tsx") {
    text = `import {useTranslation} from '../../i18n';\n${text}`;
    replace("const showsHover = !disabled", "const {t} = useTranslation();\n\tconst showsHover = !disabled");
    replace("<span style={inlineLabelText}>{children}</span>", "<span style={inlineLabelText}>{typeof children === 'string' ? t(children.trim()) : children}</span>");
    replace("fontFamily: 'sans-serif'", "fontFamily: 'inherit'");
  }
  if (file === "components/RenderButton.tsx") {
    replace("{renderLabel}", "{t(renderLabel)}");
    replace("ariaLabel: showRenderLabel ? tooltip : renderLabel", "ariaLabel: t(showRenderLabel ? tooltip : renderLabel)");
    replace("tooltipLabel: showRenderLabel ? null : renderLabel", "tooltipLabel: showRenderLabel ? null : t(renderLabel)");
    replace("\n\t\trenderLabel,", "\n\t\tt,\n\t\trenderLabel,");
  }
  return text;
}
