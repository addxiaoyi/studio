"use client";

import {
  ChevronLeft,
  ChevronRight,
  Blocks,
  Code2,
  Copy,
  FolderKanban,
  Home,
  Images,
  type LucideIcon,
  Minus,
  PanelsTopLeft,
  PanelLeftClose,
  PanelLeftOpen,
  Puzzle,
  Search,
  Settings,
  Square,
  X,
  Maximize2,
  Minimize2,
} from "lucide-react";
import Link from "next/link";
import type { MouseEvent } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { HelsteraBrandMark } from "@/components/helstera-brand-mark";
import { useAuth } from "@/lib/auth-context";
import { desktopCanvasHref, getLastDesktopCanvasId } from "@/lib/desktop-canvas";
import { useDesktopCopy, type DesktopCopy } from "@/lib/desktop-copy";

type NavigationState = { canGoBack: boolean; canGoForward: boolean };
type DesktopWindowApi = {
  onNavigate: (callback: (path: string) => void) => () => void;
  getWindowState: () => Promise<{ isMaximized: boolean }>;
  getNavigationState: () => Promise<NavigationState>;
  navigateHistory: (direction: "back" | "forward") => Promise<NavigationState>;
  minimizeWindow: () => Promise<void>;
  maximizeWindow: () => Promise<{ isMaximized: boolean }>;
  /** Optional: desktop builds older than 0.2.19 do not expose fullscreen yet, and the
   *  web shell must keep working on them instead of throwing. */
  windowFullscreen?: () => Promise<{ isFullScreen: boolean }>;
  getFullscreenState?: () => Promise<{ isFullScreen: boolean }>;
  onFullscreenState?: (
    callback: (state: { isFullScreen: boolean }) => void,
  ) => () => void;
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
  primary?: boolean | undefined;
};

type RouteCopy = DesktopCopy["chrome"]["titlebar"]["routes"];
type RouteGroupCopy = DesktopCopy["chrome"]["titlebar"]["groups"];

/** 路由表只存结构，标签与分组名一律走 desktop-copy：英文壳里不能出现中文导航。 */
const ROUTE_DEFS: ReadonlyArray<{
  href: string;
  route: keyof RouteCopy;
  group: keyof RouteGroupCopy;
  icon: LucideIcon;
  primary?: boolean;
}> = [
  { href: "/desktop-app/", route: "agent", group: "tasks", icon: Home, primary: true },
  { href: "/desktop-app/canvas/", route: "canvas", group: "tasks", icon: PanelsTopLeft, primary: true },
  { href: "/desktop-app/projects/", route: "projects", group: "resources", icon: FolderKanban, primary: true },
  { href: "/desktop-app/assets/", route: "assets", group: "resources", icon: Images, primary: true },
  { href: "/desktop-app/marketplace/", route: "marketplace", group: "extensions", icon: Puzzle, primary: true },
  { href: "/desktop-app/settings/", route: "settings", group: "app", icon: Settings, primary: true },
  { href: "/desktop-app/mcp/", route: "mcp", group: "settings", icon: Blocks, primary: true },
  { href: "/desktop-app/development/", route: "development", group: "advanced", icon: Code2 },
];

function getDesktopApi() {
  return (window as Window & { electronAPI?: DesktopWindowApi }).electronAPI;
}

const SIDEBAR_STORAGE_KEY = "helstera.desktop.sidebar";
const SIDEBAR_COLLAPSED_WIDTH = 74;
const SIDEBAR_DEFAULT_EXPANDED_WIDTH = 216;
const SIDEBAR_MIN_EXPANDED_WIDTH = 168;
const SIDEBAR_MAX_EXPANDED_WIDTH = 320;

type SidebarPreferences = { collapsed: boolean; expandedWidth: number };

/** 默认折叠：与改造前 74px 窄轨的渲染结果保持一致，避免首次进入桌面端就跳版。 */
const DEFAULT_SIDEBAR_PREFERENCES: SidebarPreferences = {
  collapsed: true,
  expandedWidth: SIDEBAR_DEFAULT_EXPANDED_WIDTH,
};

function clampExpandedWidth(value: unknown): number {
  const width = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(width)) return SIDEBAR_DEFAULT_EXPANDED_WIDTH;
  return Math.min(
    Math.max(Math.round(width), SIDEBAR_MIN_EXPANDED_WIDTH),
    SIDEBAR_MAX_EXPANDED_WIDTH,
  );
}

/** 读取折叠状态与展开宽度；存储不可用或数据损坏时回落到默认折叠态。 */
function readSidebarPreferences(): SidebarPreferences {
  try {
    const raw = window.localStorage.getItem(SIDEBAR_STORAGE_KEY);
    if (!raw) return DEFAULT_SIDEBAR_PREFERENCES;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return DEFAULT_SIDEBAR_PREFERENCES;
    const record = parsed as Partial<SidebarPreferences>;
    return {
      collapsed:
        typeof record.collapsed === "boolean"
          ? record.collapsed
          : DEFAULT_SIDEBAR_PREFERENCES.collapsed,
      expandedWidth: clampExpandedWidth(record.expandedWidth),
    };
  } catch {
    return DEFAULT_SIDEBAR_PREFERENCES;
  }
}

function persistSidebarPreferences(preferences: SidebarPreferences): void {
  try {
    window.localStorage.setItem(
      SIDEBAR_STORAGE_KEY,
      JSON.stringify(preferences),
    );
  } catch {
    // 隐私模式或配额耗尽时保持在当前会话内生效，不影响折叠本身。
  }
}

/** 折叠状态落到根元素 data 属性，展开宽度落到 CSS 变量，样式侧统一在 globals.css 消费。 */
function applySidebarPreferences(preferences: SidebarPreferences): void {
  const root = document.documentElement;
  root.dataset.sidebarCollapsed = preferences.collapsed ? "true" : "false";
  root.style.setProperty(
    "--desktop-sidebar-expanded-width",
    `${preferences.expandedWidth}px`,
  );
  root.style.setProperty(
    "--desktop-sidebar-collapsed-width",
    `${SIDEBAR_COLLAPSED_WIDTH}px`,
  );
}

function matchesRoute(route: DesktopRoute, pathname: string | null, search: string) {
  if (!pathname) return false;
  const [routePath = "", routeSearch = ""] = route.href.split("?");
  const normalizedPath = routePath.replace(/\/$/, "");
  const matchesPath = normalizedPath === "/desktop-app"
    ? pathname === normalizedPath
    : pathname === normalizedPath || pathname.startsWith(`${normalizedPath}/`);
  const matchesAdvanced = normalizedPath === "/desktop-app/mcp" && pathname.startsWith("/desktop-app/development");
  return (matchesPath || matchesAdvanced) && (!routeSearch || routeSearch === search);
}

export function DesktopTitlebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user } = useAuth();
  const { copy } = useDesktopCopy();
  const chrome = copy.chrome.titlebar;
  const routes = useMemo<DesktopRoute[]>(
    () =>
      ROUTE_DEFS.map((def) => ({
        href: def.href,
        label: chrome.routes[def.route],
        group: chrome.groups[def.group],
        icon: def.icon,
        primary: def.primary,
      })),
    [chrome],
  );
  const userId = user?.id;
  const [routeSearch, setRouteSearch] = useState("");
  const [lastCanvasId, setLastCanvasId] = useState<string | null>(null);
  const [api, setApi] = useState<DesktopWindowApi | null>(null);
  const [isMaximized, setIsMaximized] = useState(false);
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [history, setHistory] = useState<NavigationState>({
    canGoBack: false,
    canGoForward: false,
  });
  const [quickOpen, setQuickOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [chromeError, setChromeError] = useState<string | null>(null);
  const [sidebar, setSidebar] = useState<SidebarPreferences>(
    DEFAULT_SIDEBAR_PREFERENCES,
  );
  const [hasSidebar, setHasSidebar] = useState(false);
  const [pendingWindowCommand, setPendingWindowCommand] = useState<
    "minimize" | "maximize" | "fullscreen" | "close" | null
  >(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const quickOpenTriggerRef = useRef<HTMLButtonElement>(null);
  // 记录「是谁打开的 quick-open」，关闭时把焦点还回去，避免焦点掉回 body。
  const quickOpenReturnFocusRef = useRef<HTMLElement | null>(null);
  // The window-bridge wiring must run once per user. Depending on the `router` object
  // made it re-run on every render, and each re-run re-read the window state — which
  // silently reverted maximize/fullscreen the user had just toggled.
  const routerRef = useRef(router);
  routerRef.current = router;

  useEffect(() => {
    const bridge = getDesktopApi();
    if (!bridge) return;
    setRouteSearch(window.location.search.slice(1));
    const syncRouteSearch = () => setRouteSearch(window.location.search.slice(1));
    window.addEventListener("popstate", syncRouteSearch);
    window.addEventListener("desktop:route-changed", syncRouteSearch);
    setApi(bridge);
    const stopNavigate = bridge.onNavigate((path) => {
      const desktopPath = path.startsWith("/desktop-app/")
        ? path
        : "/desktop-app" + (path.startsWith("/") ? path : "/" + path);
      const destination = desktopCanvasHref(desktopPath, getLastDesktopCanvasId(userId));
      routerRef.current.replace(destination);
      setRouteSearch(destination.split("?")[1] ?? "");
      window.dispatchEvent(new Event("desktop:route-changed"));
    });
    void bridge
      .getWindowState()
      .then((state) => setIsMaximized(state.isMaximized))
      .catch(() => setChromeError(chrome.windowStateFail));
    void bridge
      .getNavigationState()
      .then(setHistory)
      .catch(() => setChromeError(chrome.historyStateFail));
    const stopWindowUpdates = bridge.onWindowState((state) =>
      setIsMaximized(state.isMaximized),
    );
    const stopFullscreenUpdates = bridge.onFullscreenState?.((state) =>
      setIsFullScreen(state.isFullScreen),
    );
    void bridge
      .getFullscreenState?.()
      .then((state) => setIsFullScreen(state.isFullScreen))
      .catch(() => {});
    const stopHistoryUpdates = bridge.onNavigationState(setHistory);
    return () => {
      window.removeEventListener("popstate", syncRouteSearch);
      window.removeEventListener("desktop:route-changed", syncRouteSearch);
      stopNavigate();
      stopWindowUpdates();
      stopFullscreenUpdates?.();
      stopHistoryUpdates();
    };
  }, [userId]);

  useEffect(() => {
    const syncCanvas = () => setLastCanvasId(getLastDesktopCanvasId(userId));
    syncCanvas();
    window.addEventListener("desktop:canvas-changed", syncCanvas);
    return () => window.removeEventListener("desktop:canvas-changed", syncCanvas);
  }, [userId]);

  // 刷新后恢复上次的折叠状态与展开宽度：先读存储，再同时写进状态与根元素。
  useEffect(() => {
    if (!api) return;
    const preferences = readSidebarPreferences();
    setSidebar(preferences);
    applySidebarPreferences(preferences);
  }, [api]);

  useEffect(() => {
    if (!quickOpen) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
    searchRef.current?.focus();
    // 浏览器原生 Escape 会先触发 dialog 的 close 事件（走 onClose → setQuickOpen(false)），
    // 因此焦点归还必须放在这个 effect 的清理函数里，才能覆盖 Escape、点选结果、编程关闭三条路径。
    const returnTarget =
      quickOpenReturnFocusRef.current ?? quickOpenTriggerRef.current;
    return () => {
      if (dialog.open) {
        if (typeof dialog.close === "function") dialog.close();
        else dialog.removeAttribute("open");
      }
      quickOpenReturnFocusRef.current = null;
      if (returnTarget?.isConnected) returnTarget.focus();
    };
  }, [quickOpen]);

  useEffect(() => {
    // 与下面的 openQuickSwitcher 不同名：同名会在闭包里递归调到监听器自身。
    function handleQuickSwitcherHotkey(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        openQuickSwitcher();
      }
    }
    window.addEventListener("keydown", handleQuickSwitcherHotkey);
    return () => window.removeEventListener("keydown", handleQuickSwitcherHotkey);
  }, []);

  // The desktop shell keeps its navigation in the titlebar, so `.desktop-workspace-sidebar`
  // is only present when an embedded workspace route mounts it. Rendering the toggle
  // unconditionally produced a visible control that moved nothing: a real-renderer E2E
  // found zero sidebar items on every /desktop-app route while the button kept flipping
  // `data-sidebar-collapsed`.
  //
  // Must stay above the early return below: a hook placed after it renders conditionally.
  useEffect(() => {
    const sync = () => setHasSidebar(Boolean(document.querySelector(".desktop-workspace-sidebar")));
    sync();
    // Embedded workspace routes mount after the titlebar paints.
    const timers = [window.setTimeout(sync, 300), window.setTimeout(sync, 1_200)];
    window.addEventListener("popstate", sync);
    window.addEventListener("desktop:route-changed", sync);
    return () => {
      for (const timer of timers) window.clearTimeout(timer);
      window.removeEventListener("popstate", sync);
      window.removeEventListener("desktop:route-changed", sync);
    };
  }, []);

  const filteredRoutes = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return routes;
    return routes.filter((route) =>
      `${route.label} ${route.group}`.toLocaleLowerCase().includes(normalized),
    );
  }, [query, routes]);

  if (!api || pathname?.startsWith("/auth/")) return null;

  function navigateTo(href: string) {
    const destination = desktopCanvasHref(href, getLastDesktopCanvasId(userId) ?? lastCanvasId);
    router.replace(destination);
    setRouteSearch(destination.split("?")[1] ?? "");
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

  /** 打开 quick-open 前记住焦点来源：显式传入的触发按钮优先，其次当前焦点元素。 */
  function rememberQuickOpenReturnFocus(origin?: HTMLElement | null) {
    const active = document.activeElement;
    const focused =
      active instanceof HTMLElement && active !== document.body ? active : null;
    quickOpenReturnFocusRef.current =
      origin ?? focused ?? quickOpenTriggerRef.current;
  }

  function openQuickSwitcher(origin?: HTMLElement | null) {
    rememberQuickOpenReturnFocus(origin);
    setQuery("");
    setQuickOpen(true);
  }

  function navigateHistory(direction: "back" | "forward") {
    setChromeError(null);
    void api
      ?.navigateHistory(direction)
      .then(setHistory)
      .catch(() => setChromeError(chrome.navigateFail));
  }

  function toggleSidebar() {
    const next: SidebarPreferences = {
      collapsed: !sidebar.collapsed,
      expandedWidth: sidebar.expandedWidth,
    };
    setSidebar(next);
    applySidebarPreferences(next);
    persistSidebarPreferences(next);
  }

  // The desktop shell keeps its navigation in the titlebar, so `.desktop-workspace-sidebar`
  // is only present when an embedded workspace route mounts it. Rendering the toggle
  // unconditionally produced a visible control that moved nothing: a real-renderer E2E
  // found zero sidebar items on every /desktop-app route while the button kept flipping
  function runWindowCommand(command: "minimize" | "maximize" | "fullscreen" | "close") {
    // 一条命令在途时锁住整组窗口按钮：既防连点重复关窗，也让 :disabled 态真实可见。
    if (pendingWindowCommand) return;
    setChromeError(null);
    setPendingWindowCommand(command);
    const failureMessage =
      command === "minimize"
        ? chrome.minimizeFail
        : command === "maximize"
          ? chrome.maximizeFail
          : command === "fullscreen"
            ? chrome.fullscreenFail
            : chrome.closeFail;
    const action =
      command === "minimize"
        ? api?.minimizeWindow()
        : command === "close"
          ? api?.closeWindow()
          : command === "fullscreen"
            ? api
                ?.windowFullscreen?.()
                .then((state) => setIsFullScreen(state.isFullScreen))
            : api?.maximizeWindow().then((state) => setIsMaximized(state.isMaximized));

    if (!action) {
      setPendingWindowCommand(null);
      return;
    }
    void action
      .catch(() => setChromeError(failureMessage))
      .finally(() => setPendingWindowCommand(null));
  }

  return (
    <>
      <header
        className="helstera-desktop-titlebar"
        aria-label={chrome.navLabel}
      >
        <div className="helstera-desktop-titlebar__start">
          <Link
            href="/desktop-app/"
            className="helstera-desktop-titlebar__brand"
            aria-label={chrome.brand}
          >
            <HelsteraBrandMark size="sm" />
          </Link>
          {hasSidebar ? (
            <button
              type="button"
              className="helstera-desktop-titlebar__sidebar-toggle"
              aria-label={sidebar.collapsed ? chrome.expandSidebar : chrome.collapseSidebar}
              aria-expanded={!sidebar.collapsed}
              title={sidebar.collapsed ? chrome.expandSidebar : chrome.collapseSidebar}
              onClick={toggleSidebar}
            >
              {sidebar.collapsed ? (
                <PanelLeftOpen aria-hidden="true" />
              ) : (
                <PanelLeftClose aria-hidden="true" />
              )}
            </button>
          ) : null}
          <div
            className="helstera-desktop-titlebar__history"
            aria-label={chrome.history}
          >
            <button
              type="button"
              aria-label={chrome.back}
              title={chrome.back}
              disabled={!history.canGoBack}
              onClick={() => navigateHistory("back")}
            >
              <ChevronLeft aria-hidden="true" />
            </button>
            <button
              type="button"
              aria-label={chrome.forward}
              title={chrome.forward}
              disabled={!history.canGoForward}
              onClick={() => navigateHistory("forward")}
            >
              <ChevronRight aria-hidden="true" />
            </button>
          </div>
          <nav
            className="helstera-desktop-titlebar__nav"
            aria-label={chrome.primaryNav}
          >
            {routes.filter((route) => route.primary).map((route) => {
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
          ref={quickOpenTriggerRef}
          type="button"
          className="helstera-desktop-titlebar__quick-open"
          onClick={() => openQuickSwitcher(quickOpenTriggerRef.current)}
        >
          <Search aria-hidden="true" />
          <span>{chrome.quickOpen}</span>
          <kbd>Ctrl K</kbd>
        </button>
        <div
          className="helstera-desktop-titlebar__controls"
          aria-label={chrome.windowControls}
        >
          <button
            type="button"
            aria-label={chrome.minimize}
            title={chrome.minimize}
            disabled={pendingWindowCommand !== null}
            onClick={() => runWindowCommand("minimize")}
          >
            <Minus aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label={isMaximized ? chrome.restore : chrome.maximize}
            title={isMaximized ? chrome.restore : chrome.maximize}
            disabled={pendingWindowCommand !== null || isFullScreen}
            onClick={() => runWindowCommand("maximize")}
          >
            {isMaximized ? (
              <Copy aria-hidden="true" />
            ) : (
              <Square aria-hidden="true" />
            )}
          </button>
          {typeof api?.windowFullscreen === "function" ? (
            <button
              type="button"
              aria-label={isFullScreen ? chrome.exitFullscreen : chrome.enterFullscreen}
              aria-pressed={isFullScreen}
              title={isFullScreen ? chrome.exitFullscreen : chrome.enterFullscreen}
              disabled={pendingWindowCommand !== null}
              onClick={() => runWindowCommand("fullscreen")}
            >
              {isFullScreen ? (
                <Minimize2 aria-hidden="true" />
              ) : (
                <Maximize2 aria-hidden="true" />
              )}
            </button>
          ) : null}
          <button
            type="button"
            className="helstera-desktop-titlebar__close"
            aria-label={chrome.close}
            title={chrome.close}
            disabled={pendingWindowCommand !== null}
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
        aria-label={chrome.quickSwitcher}
        onClose={closeQuickSwitcher}
      >
        <div className="helstera-desktop-switcher__search">
          <Search aria-hidden="true" />
          <input
            ref={searchRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={chrome.searchPlaceholder}
            aria-label={chrome.searchPlaceholder}
          />
          <kbd>ESC</kbd>
        </div>
        <ul
          className="helstera-desktop-switcher__results"
          aria-label={chrome.matches}
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
            <p className="helstera-desktop-switcher__empty">{chrome.noMatches}</p>
          )}
        </ul>
      </dialog>
    </>
  );
}
