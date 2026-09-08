"use client";

import { useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { AppSidebar } from "@/components/app-sidebar";
import {
  Users,
  Plus,
  Crown,
  Mail,
  Shield,
  MoreHorizontal,
  UserMinus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type Member = {
  id: string;
  name: string;
  email: string;
  role: "owner" | "admin" | "member";
  joinedAt: string;
  status: "active" | "pending";
};

const MOCK_MEMBERS: Member[] = [
  { id: "1", name: "当前用户", email: "you@company.com", role: "owner", joinedAt: "2024-01-01", status: "active" },
  { id: "2", name: "张设计", email: "zhang@company.com", role: "admin", joinedAt: "2024-03-15", status: "active" },
  { id: "3", name: "李创意", email: "li@company.com", role: "member", joinedAt: "2024-06-20", status: "active" },
  { id: "4", name: "王运营", email: "wang@company.com", role: "member", joinedAt: "2024-08-01", status: "pending" },
];

const ROLE_LABELS: Record<Member["role"], string> = {
  owner: "所有者",
  admin: "管理员",
  member: "成员",
};

export default function TeamPage() {
  const { user } = useAuth();
  const [members] = useState<Member[]>(MOCK_MEMBERS);
  const [search, setSearch] = useState("");

  const currentUser = members.find((m) => m.email === user?.email);
  const filtered = members.filter(
    (m) =>
      m.name.toLowerCase().includes(search.toLowerCase()) ||
      m.email.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="flex h-screen bg-background">
      <AppSidebar currentPage="team" />
      <main className="flex-1 overflow-auto">
        <div className="mx-auto max-w-4xl px-6 py-12 md:py-16">
          {/* Header */}
          <div className="mb-12 flex items-end justify-between gap-4">
            <div>
              <p className="eyebrow">Enterprise</p>
              <h1 className="mt-3 display-md text-foreground">
                团队成员
              </h1>
              <p className="mt-3 text-sm text-muted-foreground font-light">
                管理 {members.length} 位成员 · 企业空间
              </p>
            </div>
            <Button className="gap-2 shrink-0">
              <Plus className="size-4" strokeWidth={1.5} />
              邀请成员
            </Button>
          </div>

          {/* Search */}
          <div className="mb-6">
            <Input
              placeholder="搜索成员…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="max-w-xs"
            />
          </div>

          {/* Member list — glass cards */}
          <div className="space-y-3">
            {filtered.map((member) => (
              <div
                key={member.id}
                className="flex items-center gap-4 rounded-2xl glass-soft border border-border/40 px-5 py-4 transition-all duration-300 hover:glass hover:border-border/60"
              >
                {/* Avatar */}
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-foreground/8 text-foreground font-light text-sm">
                  {member.name.charAt(0).toUpperCase()}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium truncate">{member.name}</span>
                    {member.status === "pending" && (
                      <span className="inline-flex items-center gap-1 rounded-full glass-soft border border-border/40 px-2 py-0.5 text-[10px] text-muted-foreground">
                        待确认
                      </span>
                    )}
                    {member.role === "owner" && (
                      <Crown className="size-3.5 text-foreground/70" strokeWidth={1.5} />
                    )}
                  </div>
                  <div className="mt-0.5 flex items-center gap-1.5 text-sm text-muted-foreground font-light">
                    <Mail className="size-3" />
                    <span className="truncate">{member.email}</span>
                  </div>
                </div>

                {/* Role badge */}
                <span
                  className={cn(
                    "shrink-0 inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium",
                    member.role === "owner" && "bg-foreground/8 text-foreground",
                    member.role === "admin" && "bg-primary/10 text-primary",
                    member.role === "member" && "bg-muted text-muted-foreground",
                  )}
                >
                  {ROLE_LABELS[member.role]}
                </span>

                {/* Actions */}
                {member.role !== "owner" && currentUser?.role === "owner" && (
                  <DropdownMenu>
                    <DropdownMenuTrigger>
                      <Button variant="ghost" size="icon" className="size-8 shrink-0">
                        <MoreHorizontal className="size-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => undefined}>
                        <Shield className="size-4 mr-2" />
                        设为管理员
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => undefined}>
                        设为普通成员
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="text-destructive focus:text-destructive"
                        onClick={() => undefined}
                      >
                        <UserMinus className="size-4 mr-2" />
                        移除成员
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
            ))}
          </div>

          {/* Empty state */}
          {filtered.length === 0 && (
            <div className="flex flex-col items-center gap-3 py-20 text-center">
              <div className="rounded-2xl glass-soft p-4">
                <Users className="size-6 text-muted-foreground/60" strokeWidth={1.5} />
              </div>
              <p className="text-sm text-muted-foreground font-light">
                没有找到匹配的成员
              </p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
