"use client";

import { motion } from "framer-motion";
import {
  ChevronDown,
  Clapperboard,
  FileText,
  Film,
  FolderKanban,
  GalleryHorizontal,
  Grid2X2,
  Home,
  History,
  Images,
  LogOut,
  Palette,
  PackageSearch,
  Settings,
  ShoppingCart,
  Sparkles,
  Users,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { CreditBalance } from "@/components/credits/credit-balance";
import { HelsteraBrandMark } from "@/components/helstera-brand-mark";
import { useAuth } from "@/lib/auth-context";
import { t } from "@/lib/i18n";
import { fetchViewer } from "@/lib/server-api";
import { cn } from "@/lib/utils";

type NavItem = { href: string; label: string; icon: LucideIcon };
type NavGroup = { id: string; label: string; icon: LucideIcon; items: NavItem[] };

const primaryItems: NavItem[] = [
  { href: "/home", label: "工作台", icon: Home },
  { href: "/feed", label: "信息流", icon: Film },
  { href: "/assets", label: "我的资产", icon: Images },
];

const navGroups: NavGroup[] = [
  {
    id: "creation",
    label: "创作工具",
    icon: Clapperboard,
    items: [
      { href: "/create", label: "剧本创作", icon: FileText },
      { href: "/storyboard", label: "分镜工作台", icon: Clapperboard },
      { href: "/texture-lab", label: "纹理工坊", icon: Grid2X2 },
    ],
  },
  {
    id: "library",
    label: "资源库",
    icon: FolderKanban,
    items: [
      { href: "/projects", label: "项目", icon: FolderKanban },
      { href: "/brand-kit", label: "品牌套件", icon: Palette },
      { href: "/gallery", label: "作品库", icon: GalleryHorizontal },
      { href: "/prompts", label: "提示词库", icon: Sparkles },
      { href: "/ecom-images", label: "电商图", icon: ShoppingCart },
    ],
  },
  {
    id: "collaboration",
    label: "协作与扩展",
    icon: Users,
    items: [
      { href: "/team", label: "团队", icon: Users },
      { href: "/skills", label: "技能", icon: Wrench },
      { href: "/agent-history", label: "Agent 历史", icon: History },
    ],
  },
];

const marketplaceGroup: NavGroup = {
  id: "agent-marketplace",
  label: "Agent 市场",
  icon: PackageSearch,
  items: [{ href: "/marketplace", label: "Skills / MCP / 插件", icon: PackageSearch }],
};

const adminItem: NavItem = { href: "/admin", label: "管理中心", icon: Settings };
const settingsItem: NavItem = { href: "/settings", label: "设置", icon: Settings };
const allNavGroups = [...navGroups, marketplaceGroup];

function isPathActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavLink({ item, active, compact = false, collapsed = false }: { item: NavItem; active: boolean; compact?: boolean; collapsed?: boolean }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      title={item.label}
      aria-label={item.label}
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative flex min-h-10 items-center gap-3 rounded-xl px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/30",
        compact && "min-w-[68px] flex-col justify-center gap-0.5 px-2 text-[10px]",
        collapsed && "w-10 justify-center px-0",
        active ? "bg-foreground/[0.08] text-foreground" : "text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground",
      )}
    >
      <Icon className={cn("relative size-[18px] shrink-0", compact && "size-5")} strokeWidth={1.8} />
      {!collapsed && <span className={cn("whitespace-nowrap truncate animate-in fade-in slide-in-from-left-1 duration-150", compact && "max-w-16")}>{item.label}</span>}
    </Link>
  );
}

function GroupLinks({ group, pathname, open, onToggle, collapsed = false }: { group: NavGroup; pathname: string; open: boolean; onToggle: () => void; collapsed?: boolean }) {
  const GroupIcon = group.icon;
  const active = group.items.some((item) => isPathActive(pathname, item.href));
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={`${group.id}-navigation-items`}
        aria-label={group.label}
        title={group.label}
        className={cn("flex min-h-10 w-full items-center gap-3 rounded-xl px-3 text-sm transition-colors hover:bg-foreground/[0.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", collapsed && "w-10 justify-center px-0", active ? "text-foreground" : "text-muted-foreground")}
      >
        <GroupIcon className="size-[18px] shrink-0" strokeWidth={1.8} />
        {!collapsed && <span className="flex-1 text-left">{group.label}</span>}
        {!collapsed && <ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} />}
      </button>
      <div id={`${group.id}-navigation-items`} hidden={collapsed || !open} className="ml-3 space-y-0.5 border-l border-border/50 pl-3">{group.items.map((item) => <NavLink key={item.href} item={item} active={isPathActive(pathname, item.href)} />)}</div>
    </div>
  );
}

function MobileNavigation({ isAdmin, pathname }: { isAdmin: boolean; pathname: string }) {
  const [moreOpen, setMoreOpen] = useState(false);
  const moreButtonRef = useRef<HTMLButtonElement>(null);
  const moreMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!moreOpen) return;
    const closeOutside = (event: PointerEvent) => {
      if (moreMenuRef.current?.contains(event.target as Node) || moreButtonRef.current?.contains(event.target as Node)) return;
      setMoreOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setMoreOpen(false);
      moreButtonRef.current?.focus();
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [moreOpen]);

  useEffect(() => setMoreOpen(false), [pathname]);

  useEffect(() => {
    if (!moreOpen) return;
    moreMenuRef.current?.querySelector<HTMLElement>("a, button")?.focus();
  }, [moreOpen]);

  return (
    <>
      <nav className="pointer-events-auto fixed inset-x-0 bottom-0 z-40 flex min-h-14 items-center justify-around border-t border-border/40 bg-background/90 px-1 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden" aria-label="主导航">
        {primaryItems.map((item) => <NavLink key={item.href} item={item} active={isPathActive(pathname, item.href)} compact />)}
        <button ref={moreButtonRef} type="button" onClick={() => setMoreOpen((value) => !value)} aria-expanded={moreOpen} aria-controls="workspace-more-navigation" aria-label={"\u66f4\u591a\u5de5\u4f5c\u533a\u5bfc\u822a"} className={cn("flex min-h-14 min-w-[68px] flex-col items-center justify-center gap-0.5 rounded-lg text-[10px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1", moreOpen ? "text-foreground" : "text-muted-foreground")}><Wrench className="size-5" /><span>更多</span></button>
      </nav>
      {moreOpen && <div ref={moreMenuRef} id="workspace-more-navigation" role="region" aria-label="更多工作区导航" className="fixed inset-x-3 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-40 max-h-[65vh] overflow-y-auto rounded-lg border border-border/50 bg-background p-2 shadow-xl md:hidden"><div className="grid grid-cols-2 gap-1">{allNavGroups.flatMap((group) => group.items).map((item) => <NavLink key={item.href} item={item} active={isPathActive(pathname, item.href)} />)}{isAdmin && <NavLink item={adminItem} active={isPathActive(pathname, adminItem.href)} />}<NavLink item={settingsItem} active={isPathActive(pathname, settingsItem.href)} /></div></div>}
    </>
  );
}

export function AppSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { session, signOut } = useAuth();
  const [isAdmin, setIsAdmin] = useState(false);
  const [collapsed, setCollapsed] = useState(true);
  const [labelsVisible, setLabelsVisible] = useState(false);
  const revealTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});

  function expandSidebar() {
    if (revealTimer.current) clearTimeout(revealTimer.current);
    setCollapsed(false);
    revealTimer.current = setTimeout(() => setLabelsVisible(true), 220);
  }

  function collapseSidebar() {
    if (revealTimer.current) clearTimeout(revealTimer.current);
    setLabelsVisible(false);
    setCollapsed(true);
  }

  useEffect(() => () => {
    if (revealTimer.current) clearTimeout(revealTimer.current);
  }, []);

  useEffect(() => {
    if (!session?.access_token) return;
    void fetchViewer(session.access_token).then((viewer) => setIsAdmin(viewer.isSystemAdmin)).catch(() => setIsAdmin(false));
  }, [session?.access_token]);

  useEffect(() => {
    setOpenGroups((current) => {
      const next = { ...current };
      for (const group of allNavGroups) if (group.items.some((item) => isPathActive(pathname, item.href))) next[group.id] = true;
      return next;
    });
  }, [pathname]);

  const labels = t("zh-CN").workspace;
  async function handleSignOut() { await signOut(); router.replace("/login"); }

  const labelsHidden = collapsed || !labelsVisible;

  return <>
    <aside
      onMouseEnter={expandSidebar}
      onMouseLeave={collapseSidebar}
      onFocusCapture={expandSidebar}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          collapseSidebar();
        }
      }}
      aria-label="工作区侧栏"
      className={cn("relative z-30 hidden h-[100dvh] shrink-0 flex-col overflow-hidden border-r border-border/40 bg-background/75 px-3 py-4 backdrop-blur transition-[width] duration-200 md:flex", collapsed ? "w-16" : "w-56")}
    >
      <Link href="/home" title="Helstera" className={cn("mb-4 flex h-8 items-center px-2", labelsHidden && "justify-center px-0")}>
        <HelsteraBrandMark size="sm" />
      </Link>
      <div className="space-y-1">{primaryItems.map((item) => <NavLink key={item.href} item={{ ...item, label: item.href === "/home" ? labels.home : item.label }} active={isPathActive(pathname, item.href)} collapsed={labelsHidden} />)}</div>
      <div className="my-3 border-t border-border/40" />
      <div className="space-y-1">{allNavGroups.map((group) => <GroupLinks key={group.id} group={group} pathname={pathname} open={Boolean(openGroups[group.id])} collapsed={labelsHidden} onToggle={() => setOpenGroups((current) => ({ ...current, [group.id]: !current[group.id] }))} />)}</div>
      {isAdmin && <div className="mt-1"><NavLink item={adminItem} active={isPathActive(pathname, adminItem.href)} collapsed={labelsHidden} /></div>}
      <div className="mt-auto space-y-1">{!labelsHidden && <CreditBalance />}<NavLink item={{ ...settingsItem, label: labels.settings }} active={isPathActive(pathname, settingsItem.href)} collapsed={labelsHidden} /><button type="button" onClick={() => void handleSignOut()} title="退出登录" className={cn("flex min-h-10 w-full items-center gap-3 rounded-xl px-3 text-sm text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground", labelsHidden && "w-10 justify-center px-0")}><LogOut className="size-[18px]" strokeWidth={1.8} />{!labelsHidden && <span>退出登录</span>}</button></div>
    </aside>
    <MobileNavigation isAdmin={isAdmin} pathname={pathname} />
  </>;
}
