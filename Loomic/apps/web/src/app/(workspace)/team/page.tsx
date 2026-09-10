"use client";

import { useEffect, useMemo, useState } from "react";
import { Crown, Mail, Plus, Search, Users } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/auth-context";
import { fetchTeamMembers, type TeamMember } from "@/lib/server-api";
import { cn } from "@/lib/utils";

const roleLabels: Record<TeamMember["role"], string> = { owner: "所有者", admin: "管理员", member: "成员" };

export default function TeamPage() {
  const { session } = useAuth();
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = session?.access_token;
    if (!token) return;
    void fetchTeamMembers(token)
      .then(({ members: nextMembers }) => setMembers(nextMembers))
      .catch((reason) => setError(reason instanceof Error ? reason.message : "加载成员失败"))
      .finally(() => setLoading(false));
  }, [session?.access_token]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return query ? members.filter((member) => `${member.name} ${member.email}`.toLowerCase().includes(query)) : members;
  }, [members, search]);

  return (
    <main className="min-h-full overflow-auto bg-background">
      <div className="mx-auto max-w-5xl px-6 py-12 md:px-10 md:py-16">
        <header className="mb-10 flex flex-wrap items-end justify-between gap-5">
          <div>
            <p className="eyebrow">Workspace</p>
            <h1 className="mt-3 display-md text-foreground">团队成员</h1>
            <p className="mt-3 text-sm text-muted-foreground">管理当前工作区的成员与权限</p>
          </div>
          <Button type="button" className="gap-2"><Plus className="size-4" />邀请成员</Button>
        </header>

        <div className="mb-6 max-w-sm">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索成员" className="pl-9" />
          </div>
        </div>

        {loading ? <div className="space-y-3" aria-label="加载成员中">{[0, 1, 2].map((item) => <div key={item} className="h-20 animate-pulse rounded-2xl bg-foreground/[0.04]" />)}</div> : error ? <div role="alert" className="rounded-2xl border border-destructive/30 bg-destructive/[0.04] p-6 text-sm text-destructive">{error}</div> : filtered.length === 0 ? <div className="rounded-2xl border border-border/40 bg-foreground/[0.02] py-20 text-center"><Users className="mx-auto size-7 text-muted-foreground/60" /><p className="mt-3 text-sm text-muted-foreground">暂无匹配成员</p></div> : <div className="space-y-3">{filtered.map((member) => <div key={member.id} className="flex items-center gap-4 rounded-2xl border border-border/40 glass-soft px-5 py-4"><div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-foreground/[0.08] text-sm">{member.name.trim().charAt(0).toUpperCase() || "?"}</div><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><span className="truncate font-medium text-foreground">{member.name}</span>{member.role === "owner" && <Crown className="size-3.5 text-muted-foreground" />}{member.status === "pending" && <span className="text-xs text-muted-foreground">待确认</span>}</div><div className="mt-1 flex items-center gap-1.5 truncate text-sm text-muted-foreground"><Mail className="size-3 shrink-0" /><span className="truncate">{member.email}</span></div></div><span className={cn("shrink-0 rounded-full px-2.5 py-1 text-xs", member.role === "owner" && "bg-foreground/[0.08] text-foreground", member.role === "admin" && "bg-primary/10 text-primary", member.role === "member" && "bg-muted text-muted-foreground")}>{roleLabels[member.role]}</span></div>)}</div>}
      </div>
    </main>
  );
}
