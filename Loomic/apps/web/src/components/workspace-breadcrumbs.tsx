"use client";

import { ArrowLeft, ChevronRight, Home } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

const routeLabels: Record<string, string> = {
  admin: "管理中心",
  assets: "我的资产",
  "brand-kit": "品牌套件",
  create: "剧本创作",
  docs: "使用说明",
  "ecom-images": "电商图",
  feed: "信息流",
  gallery: "作品库",
  home: "工作台",
  image: "图片生成",
  history: "历史记录",
  pricing: "充值与套餐",
  projects: "项目",
  prompts: "提示词库",
  settings: "设置",
  skills: "技能",
  storyboard: "分镜工作台",
  team: "团队",
  "texture-lab": "纹理工坊",
  video: "视频生成",
  archived: "回收站",
  dashboard: "运营总览",
};

function labelFor(segment: string) {
  return (
    routeLabels[segment] ?? decodeURIComponent(segment).replaceAll("-", " ")
  );
}

export function WorkspaceBreadcrumbs() {
  const pathname = usePathname();
  const segments = pathname.split("/").filter(Boolean);

  if (segments.length < 2) return null;

  const items = segments.map((segment, index) => ({
    href: `/${segments.slice(0, index + 1).join("/")}`,
    label: labelFor(segment),
  }));
  const parent = items.at(-2);

  return (
    <nav
      aria-label="页面路径"
      className="workspace-breadcrumbs mx-4 max-w-full px-1 pt-3 pr-28 text-xs text-muted-foreground sm:mx-6 md:mx-8"
    >
      <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-2">
        <Link
          href="/home"
          aria-label="返回工作台"
          className="inline-flex min-h-8 shrink-0 items-center gap-1 rounded-md px-1.5 transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Home className="size-3.5" aria-hidden="true" />
          <span className="sr-only">工作台</span>
        </Link>
        {items.map((item, index) => {
          const current = index === items.length - 1;
          return (
            <span
              key={item.href}
              className="inline-flex min-w-0 items-center gap-1.5"
            >
              <ChevronRight
                className="size-3.5 shrink-0 text-muted-foreground/70"
                aria-hidden="true"
              />
              {current ? (
                <span
                  aria-current="page"
                  className="truncate font-medium text-foreground"
                >
                  {item.label}
                </span>
              ) : (
                <Link
                  href={item.href}
                  className="max-w-40 truncate rounded-md px-1.5 py-1 transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {item.label}
                </Link>
              )}
            </span>
          );
        })}
      </div>
      {parent ? (
        <Link
          href={parent.href}
          className={cn(
            "mt-1 inline-flex min-h-8 items-center gap-1 rounded-md px-1.5 text-[11px] transition-colors",
            "hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          )}
        >
          <ArrowLeft className="size-3.5" aria-hidden="true" />
          返回{parent.label}
        </Link>
      ) : null}
    </nav>
  );
}
