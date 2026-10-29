"use client";

import { ChevronDown, ChevronRight, FolderKanban, Images, Settings, Wrench } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import type { FocusEvent, KeyboardEvent } from "react";
import { useEffect, useRef, useState } from "react";

import { useDesktopCopy } from "@/lib/desktop-copy";

/** `mode` 同时是路由段和文案键：标签一律从 desktop-copy 取，避免壳层硬编码中文。 */
const advanced = [
  { mode: "projects", icon: FolderKanban },
  { mode: "assets", icon: Images },
  { mode: "mcp", icon: Wrench },
  { mode: "development", icon: Wrench },
] as const;

/** 方向键只在可见项之间移动，顺序与渲染顺序一致：画布、高级能力、进阶项（展开时）、设置。 */
export function DesktopWorkspaceSidebar() {
  const router = useRouter();
  const pathname = usePathname();
  const { copy } = useDesktopCopy();
  const label = copy.chrome.sidebar;
  const [mode, setMode] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const containerRef = useRef<HTMLElement>(null);
  // roving tabindex：同一时刻只有一项能被 Tab 命中，其余为 -1。
  const [activeIndex, setActiveIndex] = useState(0);
  const settingsIndex = 2 + (advancedOpen ? advanced.length : 0);
  const itemCount = settingsIndex + 1;
  // 折叠进阶项后索引可能越界，这里收敛到最后一个可见项，避免整组都没有 tabindex=0。
  const rovingIndex = Math.min(activeIndex, itemCount - 1);

  useEffect(() => {
    const syncMode = () => { const segment = window.location.pathname.split("/").filter(Boolean).pop() ?? ""; setMode(segment === "desktop-app" ? "" : segment); };
    syncMode();
    window.addEventListener("popstate", syncMode);
    window.addEventListener("desktop:route-changed", syncMode);
    return () => {
      window.removeEventListener("popstate", syncMode);
      window.removeEventListener("desktop:route-changed", syncMode);
    };
  }, []);

  function openMode(nextMode: string) {
    router.push(`/desktop-app/${nextMode}/`);
    setMode(nextMode);
    window.dispatchEvent(new Event("desktop:route-changed"));
  }

  /** 每次按键都重新取可见项：进阶项是条件渲染的，索引不能跨渲染缓存。 */
  function collectItems(): HTMLElement[] {
    const node = containerRef.current;
    if (!node) return [];
    return Array.from(node.querySelectorAll<HTMLElement>("button:not([disabled])")).filter(
      (item) => !item.hasAttribute("hidden") && item.getAttribute("aria-hidden") !== "true",
    );
  }

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    // Enter/Space 交给原生 button，这里只接管方向键与首尾跳转。
    if (
      event.key !== "ArrowDown" &&
      event.key !== "ArrowUp" &&
      event.key !== "Home" &&
      event.key !== "End"
    ) {
      return;
    }
    const items = collectItems();
    if (items.length === 0) return;
    const focusedIndex = items.indexOf(document.activeElement as HTMLElement);
    let nextIndex: number;
    if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = items.length - 1;
    } else if (focusedIndex < 0) {
      // 焦点还没落在任何一项上（例如容器刚拿到焦点）时，先进入最近的一端。
      nextIndex = event.key === "ArrowUp" ? items.length - 1 : 0;
    } else if (event.key === "ArrowDown") {
      nextIndex = Math.min(focusedIndex + 1, items.length - 1);
    } else {
      nextIndex = Math.max(focusedIndex - 1, 0);
    }
    event.preventDefault();
    const target = items[nextIndex];
    if (!target) return;
    setActiveIndex(nextIndex);
    target.focus();
    target.scrollIntoView?.({ block: "nearest" });
  }

  function handleFocus(event: FocusEvent<HTMLElement>) {
    const index = collectItems().indexOf(event.target as HTMLElement);
    if (index >= 0 && index !== rovingIndex) setActiveIndex(index);
  }

  return (
    <aside
      ref={containerRef}
      className="desktop-workspace-sidebar"
      aria-label={label.ariaLabel}
      role="navigation"
      onKeyDown={handleKeyDown}
      onFocus={handleFocus}
    >
      <div className="desktop-workspace-sidebar__section">
        <span className="desktop-workspace-sidebar__label">{label.group}</span>
        <button type="button" tabIndex={rovingIndex === 0 ? 0 : -1} className="desktop-workspace-sidebar__item" aria-current={pathname.startsWith("/desktop-app/canvas") ? "page" : undefined} title={label.canvas} onClick={() => router.replace("/desktop-app/canvas/")}>
          <FolderKanban aria-hidden="true" /><span>{label.canvas}</span>
        </button>
        <button type="button" tabIndex={rovingIndex === 1 ? 0 : -1} className="desktop-workspace-sidebar__item" aria-expanded={advancedOpen} title={label.advanced} onClick={() => setAdvancedOpen((open) => !open)}>
          {advancedOpen ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}<span>{label.advanced}</span>
        </button>
        {advancedOpen ? advanced.map(({ mode: itemMode, icon: Icon }, index) => {
          const itemLabel = label[itemMode];
          return (
            <button key={itemMode} type="button" tabIndex={rovingIndex === 2 + index ? 0 : -1} className="desktop-workspace-sidebar__item" aria-current={pathname === "/desktop" && mode === itemMode ? "page" : undefined} title={itemLabel} onClick={() => openMode(itemMode)}>
              <Icon aria-hidden="true" /><span>{itemLabel}</span>
            </button>
          );
        }) : null}
      </div>
      <button type="button" tabIndex={rovingIndex === settingsIndex ? 0 : -1} className="desktop-workspace-sidebar__settings" title={label.settings} onClick={() => router.replace("/settings/")}>
        <Settings aria-hidden="true" /><span>{label.settings}</span>
      </button>
    </aside>
  );
}
