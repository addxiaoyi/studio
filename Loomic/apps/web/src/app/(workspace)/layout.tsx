"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import type { ReactNode } from "react";

import { AppSidebar } from "@/components/app-sidebar";
import { CreditHeaderButton } from "@/components/credits/credit-header-button";
import { LoadingScreen } from "@/components/loading-screen";
import { PageTransition } from "@/components/page-transition";
import { WorkspaceBreadcrumbs } from "@/components/workspace-breadcrumbs";
import { useAuth } from "@/lib/auth-context";
import { loginPath } from "@/lib/navigation";

const routeTitles: Record<string, string> = {
  "/home": "工作台",
  "/feed": "信息流",
  "/assets": "我的资产",
  "/projects": "项目",
  "/projects/archived": "回收站",
  "/create": "剧本创作",
  "/storyboard": "分镜工作台",
  "/texture-lab": "纹理工坊",
  "/gallery": "作品库",
  "/prompts": "提示词库",
  "/ecom-images": "电商图",
  "/ecom-images/history": "电商图历史",
  "/brand-kit": "品牌套件",
  "/team": "团队",
  "/skills": "技能",
  "/settings": "设置",
};

export default function WorkspaceLayout({
  children,
}: {
  children: ReactNode;
}) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    const title = routeTitles[pathname];
    if (title) document.title = `${title} | Helstera`;
  }, [pathname]);

  useEffect(() => {
    document.getElementById("main")?.focus({ preventScroll: true });
  }, [pathname]);

  useEffect(() => {
    if (!loading && !user) {
      const currentPath = `${window.location.pathname}${window.location.search}`;
      router.replace(loginPath(currentPath));
    }
  }, [loading, user, router]);

  if (loading) {
    return <LoadingScreen />;
  }

  if (!user) {
    return null;
  }

  return (
    <div className="flex h-[100dvh] flex-col md:flex-row">
      {/* Skip navigation link -- visible only on keyboard focus for a11y */}
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[60] focus:px-5 focus:py-2.5 focus:bg-foreground focus:text-background focus:rounded-full focus:shadow-card-hover focus:font-medium focus:text-sm focus:outline-none"
      >
        跳到主内容
      </a>
      <AppSidebar />
      {/* pb-14 on mobile for the fixed bottom navigation bar, reset on md+ */}
      <main
        id="main"
        tabIndex={-1}
        className="workspace-main relative min-w-0 flex-1 overflow-auto pb-[calc(3.5rem+env(safe-area-inset-bottom))] md:pb-0"
      >
        {/* Top-right header credits button */}
        <div className="absolute right-4 top-3 z-10">
          <CreditHeaderButton />
        </div>
        <WorkspaceBreadcrumbs />
        <PageTransition>{children}</PageTransition>
      </main>
    </div>
  );
}
