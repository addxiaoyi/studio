"use client";

import {
  ChevronLeft,
  ChevronRight,
  Clapperboard,
  Blocks,
  Code2,
  Copy,
  FilePlus2,
  Film,
  FolderKanban,
  Home,
  Images,
  type LucideIcon,
  Minus,
  PanelsTopLeft,
  Search,
  Settings,
  Square,
  X,
} from "lucide-react";
import Link from "next/link";
import type { MouseEvent } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { HelsteraBrandMark } from "@/components/helstera-brand-mark";

type NavigationState = { canGoBack: boolean; canGoForward: boolean };
type DesktopWindowApi = {
  getWindowState: () => Promise<{ isMaximized: boolean }>;
  getNavigationState: () => Promise<NavigationState>;
  navigateHistory: (direction: "back" | "forward") => Promise<NavigationState>;
  minimizeWindow: () => Promise<void>;
  maximizeWindow: () => Promise<{ isMaximized: boolean }>;
  closeWindow: () => Promise<void>;
  onWindowState: (
    callback: (state: { isMaximized: boolean }) => void,
  ) => () => void;
  onNavigationState: (callback: (state: NavigationState) => void) => () => void;
};
type DesktopRoute = {
  href: string;
  label: string;
  group: string;
  icon: LucideIcon;
};

const routes: DesktopRoute[] = [
  { href: "/desktop-app/", label: "Agent", group: "任务", icon: Home },
  { href: "/desktop-app/canvas/", label: "画布", group: "任务", icon: PanelsTopLeft },
  { href: "/desktop-app/projects/", label: "项目", group: "资源", icon: FolderKanban },
  { href: "/desktop-app/assets/", label: "素材库", group: "资源", icon: Images },
  { href: "/desktop-app/mcp/", label: "高级能力", group: "设置", icon: Blocks },
  { href: "/gallery/", label: "作品集", group: "资源", icon: Images },
  { href: "/brand-kit/", label: "品牌资产", group: "资源", icon: Settings },
  { href: "/settings/", label: "设置", group: "管理", icon: Settings },
  { href: "/storyboard/", label: "分镜工作台", group: "创作", icon: Clapperboard },
  { href: "/feed/", label: "内容增长 Feed", group: "创作", icon: Film },
  {
    href: "/desktop-app/development/",
    label: "本地开发与 MCP",
    group: "辅助",
    icon: Code2,
  },
];

function getDesktopApi() {
  return (window as Window & { electronAPI?: DesktopWindowApi }).electronAPI;
}

function matchesRoute(route: DesktopRoute, pathname: string | null, search: string) {
  if (!pathname) return false;
  const [routePath = "", routeSearch = ""] = route.href.split("?");
  const normalizedPath = routePath.replace(/\/$/, "");
  const matchesPath = normalizedPath === "/desktop-app"
    ? pathname === normalizedPath
    : pathname === normalizedPath || pathname.startsWith(`${normalizedPath}/`);
  return matchesPath && (!routeSearch || routeSearch === search);
}

export function DesktopTitlebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [routeSearch, setRouteSearch] = useState("");
  const [api, setApi] = useState<DesktopWindowApi | null>(null);
  const [isMaximized, setIsMaximized] = useState(false);
  const [history, setHistory] = useState<NavigationState>({
    canGoBack: false,
    canGoForward: false,
  });
  const [quickOpen, setQuickOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [chromeError, setChromeError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const bridge = getDesktopApi();
    if (!bridge) return;
    setRouteSearch(window.location.search.slice(1));
    const syncRouteSearch = () => setRouteSearch(window.location.search.slice(1));
    window.addEventListener("popstate", syncRouteSearch);
    window.addEventListener("desktop:route-changed", syncRouteSearch);
    setApi(bridge);
    void bridge
      .getWindowState()
      .then((state) => setIsMaximized(state.isMaximized))
      .catch(() => setChromeError("无法读取窗口状态。"));
    void bridge
      .getNavigationState()
      .then(setHistory)
      .catch(() => setChromeError("无法读取页面历史。"));
    const stopWindowUpdates = bridge.onWindowState((state) =>
      setIsMaximized(state.isMaximized),
    );
    const stopHistoryUpdates = bridge.onNavigationState(setHistory);
    return () => {
      window.removeEventListener("popstate", syncRouteSearch);
      window.removeEventListener("desktop:route-changed", syncRouteSearch);
      stopWindowUpdates();
      stopHistoryUpdates();
    };
  }, []);

  useEffect(() => {
    if (!quickOpen) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
    searchRef.current?.focus();
    return () => {
      if (!dialog.open) return;
      if (typeof dialog.close === "function") dialog.close();
      else dialog.removeAttribute("open");
    };
  }, [quickOpen]);

  useEffect(() => {
    function openQuickSwitcher(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setQuery("");
        setQuickOpen(true);
      }
    }
    window.addEventListener("keydown", openQuickSwitcher);
    return () => window.removeEventListener("keydown", openQuickSwitcher);
  }, []);

  const filteredRoutes = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return routes;
    return routes.filter((route) =>
      `${route.label} ${route.group}`.toLocaleLowerCase().includes(normalized),
    );
  }, [query]);

  if (!api || pathname?.startsWith("/auth/")) return null;

  function navigateTo(href: string) {
    router.replace(href);
    setRouteSearch(href.split("?")[1] ?? "");
    window.dispatchEvent(new Event("desktop:route-changed"));
    setQuickOpen(false);
  }

  function navigateInWindow(
    event: MouseEvent<HTMLAnchorElement>,
    href: string,
  ) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigateTo(href);
  }

  function closeQuickSwitcher() {
    setQuickOpen(false);
  }

  function navigateHistory(direction: "back" | "forward") {
    setChromeError(null);
    void api
      ?.navigateHistory(direction)
      .then(setHistory)
      .catch(() => setChromeError("页面导航失败，请重试。"));
  }

  function toggleMaximize() {
    setChromeError(null);
    void api
      ?.maximizeWindow()
      .then((state) => setIsMaximized(state.isMaximized))
      .catch(() => setChromeError("窗口大小调整失败。"));
  }

  function runWindowCommand(command: "minimize" | "close") {
    setChromeError(null);
    const action =
      command === "minimize" ? api?.minimizeWindow() : api?.closeWindow();
    void action?.catch(() =>
      setChromeError(
        command === "minimize" ? "窗口最小化失败。" : "窗口关闭失败。",
      ),
    );
  }

  return (
    <>
      <header
        className="helstera-desktop-titlebar"
        aria-label="Helstera 桌面导航"
      >
        <div className="helstera-desktop-titlebar__start">
          <Link
            href="/desktop-app/"
            className="helstera-desktop-titlebar__brand"
            aria-label="Helstera Desktop Agent"
          >
            <HelsteraBrandMark size="sm" />
          </Link>
          <div
            className="helstera-desktop-titlebar__history"
            aria-label="页面历史"
          >
            <button
              type="button"
              aria-label="后退"
              title="后退"
              disabled={!history.canGoBack}
              onClick={() => navigateHistory("back")}
            >
              <ChevronLeft aria-hidden="true" />
            </button>
            <button
              type="button"
              aria-label="前进"
              title="前进"
              disabled={!history.canGoForward}
              onClick={() => navigateHistory("forward")}
            >
              <ChevronRight aria-hidden="true" />
            </button>
          </div>
          <nav
            className="helstera-desktop-titlebar__nav"
            aria-label="常用工作区"
          >
            {routes.slice(0, 5).map((route) => {
              const Icon = route.icon;
              return (
                <Link
                  key={route.href}
                  href={route.href}
                  onClick={(event) => navigateInWindow(event, route.href)}
                  aria-current={
                    matchesRoute(route, pathname, routeSearch) ? "page" : undefined
                  }
                  title={route.label}
                >
                  <Icon aria-hidden="true" />
                  <span>{route.label}</span>
                </Link>
              );
            })}
          </nav>
        </div>
        <button
          type="button"
          className="helstera-desktop-titlebar__quick-open"
          onClick={() => {
            setQuery("");
            setQuickOpen(true);
          }}
        >
          <Search aria-hidden="true" />
          <span>跳转到工作区或功能</span>
          <kbd>Ctrl K</kbd>
        </button>
        <div
          className="helstera-desktop-titlebar__controls"
          aria-label="窗口控制"
        >
          <button
            type="button"
            aria-label="最小化"
            title="最小化"
            onClick={() => runWindowCommand("minimize")}
          >
            <Minus aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label={isMaximized ? "还原" : "最大化"}
            title={isMaximized ? "还原" : "最大化"}
            onClick={toggleMaximize}
          >
            {isMaximized ? (
              <Copy aria-hidden="true" />
            ) : (
              <Square aria-hidden="true" />
            )}
          </button>
          <button
            type="button"
            className="helstera-desktop-titlebar__close"
            aria-label="关闭"
            title="关闭"
            onClick={() => runWindowCommand("close")}
          >
            <X aria-hidden="true" />
          </button>
        </div>
      </header>
      {chromeError ? (
        <output className="helstera-desktop-chrome-error" aria-live="polite">
          {chromeError}
        </output>
      ) : null}

      <dialog
        ref={dialogRef}
        className="helstera-desktop-switcher"
        aria-label="快速跳转"
        onClose={closeQuickSwitcher}
      >
        <div className="helstera-desktop-switcher__search">
          <Search aria-hidden="true" />
          <input
            ref={searchRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索页面和工作区"
            aria-label="搜索页面和工作区"
          />
          <kbd>ESC</kbd>
        </div>
        <ul
          className="helstera-desktop-switcher__results"
          aria-label="匹配的工作区"
        >
          {filteredRoutes.length ? (
            filteredRoutes.map((route) => {
              const Icon = route.icon;
              return (
                <li key={route.href}>
                  <button
                    type="button"
                    aria-current={
                      matchesRoute(route, pathname, routeSearch) ? "page" : undefined
                    }
                    onClick={() => navigateTo(route.href)}
                  >
                    <Icon aria-hidden="true" />
                    <span>{route.label}</span>
                    <small>{route.group}</small>
                  </button>
                </li>
              );
            })
          ) : (
            <p className="helstera-desktop-switcher__empty">没有匹配的功能</p>
          )}
        </ul>
      </dialog>
    </>
  );
}
