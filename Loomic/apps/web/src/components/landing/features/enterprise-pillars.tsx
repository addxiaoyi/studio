"use client";

import { Users, Lock, Workflow } from "lucide-react";
import type { LucideIcon } from "lucide-react";

/**
 * Three-pillar glass grid for enterprise concerns (collaboration,
 * security, integrations). Lays out after the main feature rows.
 */
interface Pillar {
  icon: LucideIcon;
  title: string;
  desc: string;
}

const PILLARS: Pillar[] = [
  {
    icon: Users,
    title: "按工程整理",
    desc: "把画布、素材和工作流放在同一个工程中，继续已有的创作。",
  },
  {
    icon: Lock,
    title: "私有资源访问",
    desc: "登录后访问自己的工程与素材，公开作品由发布操作控制。",
  },
  {
    icon: Workflow,
    title: "可视化工作流",
    desc: "连接输入、生成与交付节点，运行前检查问题并确认费用。",
  },
];

export function EnterprisePillars() {
  return (
    <div className="mt-32 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {PILLARS.map((p) => (
        <div key={p.title} className="glass rounded-2xl p-7">
          <p.icon
            className="size-5 text-foreground/70 mb-6"
            strokeWidth={1.5}
          />
          <h4 className="font-medium text-base">{p.title}</h4>
          <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
            {p.desc}
          </p>
        </div>
      ))}
    </div>
  );
}
