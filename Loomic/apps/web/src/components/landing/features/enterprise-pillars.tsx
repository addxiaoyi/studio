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
    title: "团队实时协作",
    desc: "多光标、评论、版本历史——团队成员在同一画布上同步编辑。",
  },
  {
    icon: Lock,
    title: "企业级安全合规",
    desc: "SOC 2 Type II、GDPR、CCPA、SSO/SCIM，私有化部署可选购。",
  },
  {
    icon: Workflow,
    title: "完整 API & 集成",
    desc: "接入 Figma、Slack、Notion、Jira，资产自动同步到企业知识库。",
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
