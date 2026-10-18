"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { t, useLocale } from "@/lib/i18n";

interface TeamInviteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function TeamInviteDialog({
  open,
  onOpenChange,
}: TeamInviteDialogProps) {
  const copy = t(useLocale()).team;
  const roleOptions = [
    { value: "member", label: copy.member, description: copy.memberDesc },
    { value: "admin", label: copy.admin, description: copy.adminDesc },
    { value: "billing", label: copy.billing, description: copy.billingDesc },
  ];
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("member");
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [inviteLink] = useState(
    () => `https://helstera.com/invite?workspace=ws_abc123`,
  );

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
        <h2 className="text-lg font-medium mb-4">{copy.invite}</h2>

        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium text-muted-foreground mb-1.5 block">
              {copy.email}
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
              {copy.role}
            </label>
            <div className="space-y-2.5">
              {roleOptions.map((opt) => (
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
                      <span className="text-xs text-accent font-medium">
                        {copy.selected}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {opt.description}
                  </p>
                </button>
              ))}
            </div>
          </div>

          <div className="relative py-3">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="glass-soft border border-border/30 px-2.5 py-0.5 rounded-full text-muted-foreground tracking-wider">
                {copy.or}
              </span>
            </div>
          </div>

          <div>
            <label className="text-sm font-medium text-muted-foreground mb-1.5 block">
              {copy.copyLink}
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
                {copied ? copy.copied : copy.copy}
              </Button>
            </div>
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {copy.cancel}
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
            {copy.sendInvite}
          </Button>
        </div>
      </div>
    </div>
  );
}
