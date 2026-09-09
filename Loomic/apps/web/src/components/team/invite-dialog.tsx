"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

interface TeamInviteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const ROLE_OPTIONS = [
  { value: "member", label: "成员", description: "可以创建和编辑项目" },
  { value: "admin", label: "管理员", description: "管理团队成员和设置" },
  { value: "billing", label: "额度管理员", description: "管理额度充值和账单" },
];

export function TeamInviteDialog({ open, onOpenChange }: TeamInviteDialogProps) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("member");
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [inviteLink] = useState(() => `https://helstera.com/invite?workspace=ws_abc123`);

  const handleCopyLink = async () => {
    await navigator.clipboard.writeText(inviteLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={() => onOpenChange(false)}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-border/40 glass-strong p-6 shadow-card-hover"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-medium mb-4">邀请成员</h2>

        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium text-muted-foreground mb-1.5 block">
              邮箱地址
            </label>
            <Input
              type="email"
              placeholder="colleague@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <div>
            <label className="text-sm font-medium text-muted-foreground mb-2 block">
              角色
            </label>
            <div className="space-y-2.5">
              {ROLE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setRole(opt.value)}
                  className={cn(
                    "w-full rounded-lg border p-3 text-left transition-all duration-300",
                    role === opt.value
                      ? "border-accent bg-accent/5"
                      : "border-border hover:bg-foreground/[0.04]",
                  )}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">{opt.label}</span>
                    {role === opt.value && (
                      <span className="text-xs text-accent font-medium">已选择</span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">{opt.description}</p>
                </button>
              ))}
            </div>
          </div>

          <div className="relative py-3">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="glass-soft border border-border/30 px-2.5 py-0.5 rounded-full text-muted-foreground tracking-wider">或</span>
            </div>
          </div>

          <div>
            <label className="text-sm font-medium text-muted-foreground mb-1.5 block">
              复制邀请链接
            </label>
            <div className="flex gap-2">
              <Input
                readOnly
                value={inviteLink}
                className="text-xs font-mono"
              />
              <Button
                variant="outline"
                size="sm"
                onClick={handleCopyLink}
                className="shrink-0"
              >
                {copied ? "已复制" : "复制"}
              </Button>
            </div>
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            disabled={!email || loading}
            onClick={() => {
              setLoading(true);
              setTimeout(() => {
                setLoading(false);
                setEmail("");
                onOpenChange(false);
              }, 800);
            }}
          >
            发送邀请
          </Button>
        </div>
      </div>
    </div>
  );
}
