"use client";

import { ChevronDown, ChevronRight, FolderKanban, Images, Settings, Wrench } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

const advanced = [
  { mode: "projects", label: "项目", icon: FolderKanban },
  { mode: "assets", label: "素材", icon: Images },
  { mode: "mcp", label: "MCP 工具", icon: Wrench },
  { mode: "development", label: "本地开发", icon: Wrench },
] as const;

export function DesktopWorkspaceSidebar() {
  const router = useRouter();
  const pathname = usePathname();
  const [mode, setMode] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);

  useEffect(() => {
    const syncMode = () => setMode(new URLSearchParams(window.location.search).get("mode") ?? "");
    syncMode();
    window.addEventListener("popstate", syncMode);
    window.addEventListener("desktop:route-changed", syncMode);
    return () => {
      window.removeEventListener("popstate", syncMode);
      window.removeEventListener("desktop:route-changed", syncMode);
    };
  }, []);

  function openMode(nextMode: string) {
    router.replace(`/desktop/?mode=${nextMode}`);
    setMode(nextMode);
    window.dispatchEvent(new Event("desktop:route-changed"));
  }

  return (
    <aside className="desktop-workspace-sidebar" aria-label="桌面模块">
      <div className="desktop-workspace-sidebar__section">
        <span className="desktop-workspace-sidebar__label">WORKSPACE</span>
        <button type="button" className="desktop-workspace-sidebar__item" aria-current={pathname.startsWith("/desktop-app/canvas") ? "page" : undefined} title="画布" onClick={() => router.replace("/desktop-app/canvas/")}>
          <FolderKanban aria-hidden="true" /><span>画布</span>
        </button>
        <button type="button" className="desktop-workspace-sidebar__item" aria-expanded={advancedOpen} title="高级能力" onClick={() => setAdvancedOpen((open) => !open)}>
          {advancedOpen ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}<span>高级能力</span>
        </button>
        {advancedOpen ? advanced.map(({ mode: itemMode, label, icon: Icon }) => (
          <button key={itemMode} type="button" className="desktop-workspace-sidebar__item" aria-current={pathname === "/desktop" && mode === itemMode ? "page" : undefined} title={label} onClick={() => openMode(itemMode)}>
            <Icon aria-hidden="true" /><span>{label}</span>
          </button>
        )) : null}
      </div>
      <button type="button" className="desktop-workspace-sidebar__settings" title="设置" onClick={() => router.replace("/settings/")}>
        <Settings aria-hidden="true" /><span>设置</span>
      </button>
    </aside>
  );
}
