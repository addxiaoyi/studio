"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Activity,
  ArrowLeft,
  Boxes,
  CreditCard,
  FileClock,
  FileCog,
  Gauge,
  Images,
  LayoutDashboard,
  ListChecks,
  Menu,
  Network,
  Settings2,
  ShieldCheck,
  UploadCloud,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";

import { useAuth } from "@/lib/auth-context";
import { fetchViewer } from "@/lib/server-api";
import { loginPath } from "@/lib/navigation";

type AdminItem = { href: string; label: string; hint: string; icon: LucideIcon };
type AdminSection = { label: string; items: AdminItem[] };
const sections: AdminSection[] = [
  {
    label: "Overview",
    items: [
      { href: "/admin/dashboard", label: "运营总览", hint: "全站状态与关键指标", icon: LayoutDashboard },
      { href: "/admin/health", label: "系统健康", hint: "依赖、队列与服务状态", icon: Gauge },
    ],
  },
  {
    label: "Operations",
    items: [
      { href: "/admin/jobs", label: "任务中心", hint: "队列、重试与失败任务", icon: ListChecks },
      { href: "/admin/users", label: "用户与额度", hint: "账号、角色与余额", icon: Users },
      { href: "/admin/images", label: "资产库", hint: "生成资产与删除记录", icon: Images },
      { href: "/admin/uploads", label: "上传管理", hint: "文件与存储占用", icon: UploadCloud },
      { href: "/admin/moderation-logs", label: "审核日志", hint: "内容与管理员操作", icon: FileClock },
      { href: "/admin/billing", label: "账单流水", hint: "充值、扣费与退款", icon: CreditCard },
      { href: "/admin/payments", label: "支付事件", hint: "回调与支付状态", icon: Activity },
    ],
  },
  {
    label: "AI Control",
    items: [
      { href: "/admin/providers", label: "Provider 与模型", hint: "密钥、模型、价格与验证", icon: Network },
      { href: "/admin/model-probe", label: "模型调用探针", hint: "无扣费检查请求与响应契约", icon: Network },
      { href: "/admin/douyin-mcp", label: "抖音 MCP", hint: "工具目录与服务连接状态", icon: Network },
    ],
  },
  {
    label: "System",
    items: [
      { href: "/admin/settings", label: "系统设置", hint: "默认模型、环境与 OAuth", icon: Settings2 },
    ],
  },
];

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}
export default function AdminLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { loading, session } = useAuth();
  const [authorized, setAuthorized] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    if (loading) return;
    if (!session?.access_token) {
      router.replace(loginPath(pathname));
      return;
    }
    void fetchViewer(session.access_token)
      .then((viewer) => {
        if (!viewer.isSystemAdmin) {
          router.replace("/home");
          return;
        }
        setAuthorized(true);
      })
      .catch(() => router.replace("/home"));
  }, [loading, router, session?.access_token]);

  const activeItem = useMemo(
    () => sections.flatMap((section) => section.items).find((item) => isActive(pathname, item.href)),
    [pathname],
  );

  if (!authorized) {
    return <div className="min-h-[100dvh] bg-background" aria-busy="true" />;
  }

  const navigation = (
    <nav className="space-y-6" aria-label="Admin navigation">
      {sections.map((section) => (
        <div key={section.label}>
          <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/60">
            {section.label}
          </p>
          <div className="space-y-1">
            {section.items.map((item) => {
              const active = isActive(pathname, item.href);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMobileOpen(false)}
                  className={`group flex items-center gap-3 rounded-xl px-3 py-2.5 transition ${active ? "bg-foreground text-background shadow-sm" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
                >
                  <Icon className="size-4 shrink-0" />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{item.label}</span>
                    <span className={`mt-0.5 block truncate text-[10px] ${active ? "text-background/70" : "text-muted-foreground/70 group-hover:text-muted-foreground"}`}>{item.hint}</span>
                  </span>
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );

  return (
    <div className="min-h-[100dvh] bg-[radial-gradient(circle_at_top_left,hsl(var(--muted)/.55),transparent_32rem)]">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-72 flex-col border-r border-border/50 bg-background/90 px-4 py-5 backdrop-blur-xl lg:flex">
        <div className="mb-7 flex items-center justify-between px-2">
          <Link href="/admin/dashboard" className="flex items-center gap-3">
            <span className="flex size-9 items-center justify-center rounded-xl bg-foreground text-background"><ShieldCheck className="size-5" /></span>
            <span><span className="block text-sm font-semibold">Admin Center</span><span className="block text-[10px] text-muted-foreground">Helstera control plane</span></span>
          </Link>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto pr-1">{navigation}</div>
        <Link href="/home" className="mt-5 flex items-center gap-2 rounded-xl border border-border/50 px-3 py-2.5 text-xs text-muted-foreground transition hover:bg-muted hover:text-foreground"><ArrowLeft className="size-4" />返回工作台</Link>
      </aside>

      {mobileOpen && <div className="fixed inset-0 z-40 bg-black/40 lg:hidden" onClick={() => setMobileOpen(false)} aria-hidden="true" />}
      <aside className={`fixed inset-y-0 left-0 z-50 flex w-[min(20rem,88vw)] flex-col border-r border-border/50 bg-background px-4 py-5 shadow-2xl transition-transform lg:hidden ${mobileOpen ? "translate-x-0" : "-translate-x-full"}`}>
        <div className="mb-7 flex items-center justify-between px-2"><span className="text-sm font-semibold">Admin Center</span><button type="button" onClick={() => setMobileOpen(false)} aria-label="Close navigation" className="rounded-lg p-2 hover:bg-muted"><X className="size-4" /></button></div>
        <div className="min-h-0 flex-1 overflow-y-auto">{navigation}</div>
        <Link href="/home" onClick={() => setMobileOpen(false)} className="mt-5 flex items-center gap-2 rounded-xl border border-border/50 px-3 py-2.5 text-xs text-muted-foreground"><ArrowLeft className="size-4" />返回工作台</Link>
      </aside>

      <main className="min-w-0 lg:pl-72">
        <header className="sticky top-0 z-30 border-b border-border/40 bg-background/80 px-4 py-3 backdrop-blur-xl sm:px-6 lg:px-10">
          <div className="mx-auto flex max-w-[1400px] items-center justify-between gap-4">
            <div className="flex items-center gap-3"><button type="button" onClick={() => setMobileOpen(true)} className="rounded-lg p-2 hover:bg-muted lg:hidden" aria-label="Open navigation"><Menu className="size-5" /></button><div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/60">System Admin</p><p className="mt-0.5 text-sm font-medium text-foreground">{activeItem?.label ?? "Admin Center"}</p></div></div>
            <div className="flex items-center gap-2"><span className="hidden items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1.5 text-[11px] text-emerald-700 sm:inline-flex"><span className="size-1.5 rounded-full bg-emerald-500" />系统正常</span><Link href="/home" className="rounded-lg border border-border/50 px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground">工作台</Link></div>
          </div>
        </header>
        <div className="mx-auto max-w-[1400px]">{children}</div>
      </main>
    </div>
  );
}
