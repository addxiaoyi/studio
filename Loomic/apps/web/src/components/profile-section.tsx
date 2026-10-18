"use client";

import { useState } from "react";
import { Link2, Plus, Unplug } from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { StyledSelect } from "./ui/styled-select";
import type { PublishingAccount } from "@/lib/server-api";

interface ProfileSectionProps {
  displayName: string;
  email: string;
  onSave: (displayName: string) => Promise<void>;
  accounts: PublishingAccount[];
  accountBusy: boolean;
  onBindAccount: (input: { platform: string; alias: string; connectionMode: PublishingAccount["connection_mode"] }) => Promise<void>;
  onRevokeAccount: (accountId: string) => Promise<void>;
}

export function ProfileSection({
  displayName: initialName,
  email,
  onSave,
  accounts,
  accountBusy,
  onBindAccount,
  onRevokeAccount,
}: ProfileSectionProps) {
  const [displayName, setDisplayName] = useState(initialName);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);
  const [accountAlias, setAccountAlias] = useState("");
  const [accountPlatform, setAccountPlatform] = useState("douyin");
  const [connectionMode, setConnectionMode] = useState<PublishingAccount["connection_mode"]>("scan_confirm");
  const [showAccountForm, setShowAccountForm] = useState(false);

  const hasChanges = displayName.trim() !== initialName;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = displayName.trim();
    if (!trimmed) return;

    setSaving(true);
    setFeedback(null);

    try {
      await onSave(trimmed);
      setFeedback({ type: "success", message: "资料已更新。" });
    } catch {
      setFeedback({
        type: "error",
        message: "更新失败，请稍后重试。",
      });
    } finally {
      setSaving(false);
    }
  }

  async function bindAccount() {
    if (!accountAlias.trim()) {
      setFeedback({ type: "error", message: "请先填写账号别名，例如“品牌主账号”。" });
      return;
    }
    try {
      await onBindAccount({ platform: accountPlatform, alias: accountAlias.trim(), connectionMode });
      setAccountAlias("");
      setShowAccountForm(false);
      setFeedback({ type: "success", message: "账号已绑定。平台登录凭证不保存在本站。" });
    } catch (error) {
      setFeedback({ type: "error", message: error instanceof Error ? error.message : "账号绑定失败，请重试。" });
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-xl font-medium text-foreground">个人资料</h2>
        <p className="mt-2 text-sm text-muted-foreground font-light">
          管理你的个人信息和显示偏好。
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6 max-w-md">
        <div className="space-y-2.5">
          <Label htmlFor="displayName">显示名称</Label>
          <Input
            id="displayName"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="你的名字"
          />
        </div>

        <div className="space-y-2.5">
          <Label htmlFor="email">邮箱</Label>
          <Input id="email" value={email} disabled className="opacity-60" />
          <p className="text-xs text-muted-foreground">
            邮箱地址无法修改。
          </p>
        </div>

        {feedback && (
          <p
            role={feedback.type === "error" ? "alert" : "status"}
            aria-live={feedback.type === "error" ? "assertive" : "polite"}
            className={`text-sm ${feedback.type === "success" ? "text-success" : "text-destructive"}`}
          >
            {feedback.message}
          </p>
        )}

        <Button
          type="submit"
          disabled={saving || !hasChanges}
          className="rounded-full bg-foreground text-background hover:bg-foreground/90"
        >
          {saving ? "保存中..." : "保存"}
        </Button>
      </form>

      <section className="space-y-5 border-t border-border/60 pt-8" aria-labelledby="social-accounts-title">
        <div>
          <h3 id="social-accounts-title" className="text-lg font-medium text-foreground">社交媒体账号</h3>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">在这里绑定和解绑账号，信息流只负责选择账号和创建发布任务。本站不保存平台密码、Cookie 或浏览器登录态。</p>
        </div>
        <div className="space-y-2">
          {accounts.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">暂未绑定账号。添加后即可在信息流排程中选择。</div>
          ) : accounts.map((account) => (
            <div key={account.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/60 bg-card p-4">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">{account.alias}</p>
                <p className="mt-1 text-xs text-muted-foreground">{platformLabel(account.platform)} · {modeLabel(account.connection_mode)}</p>
              </div>
              <Button type="button" variant="outline" size="sm" disabled={accountBusy} onClick={() => void onRevokeAccount(account.id)}><Unplug className="mr-1.5 size-3.5" />解绑</Button>
            </div>
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {socialPlatforms.map((platform) => (
            <div key={platform.id} className="rounded-xl border border-border/60 p-4">
              <div className="flex items-start justify-between gap-3">
                <div><p className="text-sm font-medium">{platform.label}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{platform.description}</p></div>
                <Link2 className="size-4 shrink-0 text-muted-foreground" />
              </div>
              <Button type="button" variant="outline" className="mt-4 w-full" disabled={platform.id !== "douyin"} onClick={() => { if (platform.id === "douyin") window.location.href = "/api/integrations/douyin/oauth/start" }} title={platform.id === "douyin" ? "打开抖音授权页" : "请先完成管理员 OAuth 配置"}>{platform.id === "douyin" ? "授权连接" : "授权连接 · 待管理员配置"}</Button>
            </div>
          ))}
        </div>
        <Button type="button" variant="outline" onClick={() => setShowAccountForm((value) => !value)}><Plus className="mr-2 size-4" />{showAccountForm ? "收起添加表单" : "添加确认发布账号"}</Button>
        {showAccountForm && (
          <div className="grid gap-4 rounded-xl border border-border/60 bg-muted/20 p-4 sm:grid-cols-2">
            <label className="space-y-2 text-xs font-medium">平台<StyledSelect value={accountPlatform} onChange={setAccountPlatform} aria-label="社交平台" options={platformOptions} /></label>
            <label className="space-y-2 text-xs font-medium">连接方式<StyledSelect value={connectionMode} onChange={(value) => setConnectionMode(value as PublishingAccount["connection_mode"])} aria-label="连接方式" options={modeOptions} /></label>
            <label className="space-y-2 text-xs font-medium sm:col-span-2">账号别名<Input value={accountAlias} onChange={(event) => setAccountAlias(event.target.value)} placeholder="例如：品牌主账号" aria-label="账号别名" /></label>
            <Button type="button" className="sm:col-span-2" disabled={accountBusy} onClick={() => void bindAccount()}>{accountBusy ? "绑定中..." : "添加并保存账号"}</Button>
          </div>
        )}
        <p className="text-xs leading-5 text-muted-foreground">OAuth 按钮会在管理员完成平台凭证配置并确认审核通过后开放。当前可先使用“确认后发布”完成安全闭环。</p>
      </section>
    </div>
  );
}

const platformOptions = [
  { value: "douyin", label: "抖音", note: "默认确认发布" },
  { value: "xiaohongshu", label: "小红书", note: "确认发布或本机扩展" },
  { value: "kuaishou", label: "快手", note: "确认发布" },
  { value: "zhihu", label: "知乎", note: "跳转平台发布" },
  { value: "bilibili", label: "B站", note: "确认发布" },
  { value: "wechat_channels", label: "视频号", note: "确认发布" },
  { value: "wechat_official", label: "公众号", note: "确认发布" },
  { value: "tiktok", label: "TikTok", note: "跨境电商短视频 / OAuth 待配置" },
  { value: "instagram", label: "Instagram", note: "跨境电商内容 / OAuth 待配置" },
  { value: "facebook", label: "Facebook", note: "社群与广告内容 / OAuth 待配置" },
  { value: "youtube", label: "YouTube", note: "长视频与 Shorts / OAuth 待配置" },
  { value: "pinterest", label: "Pinterest", note: "商品灵感与目录 / OAuth 待配置" },
  { value: "x", label: "X", note: "海外品牌内容 / OAuth 待配置" },
  { value: "x", label: "X", note: "海外品牌内容 / OAuth 待配置" },
];

const modeOptions = [
  { value: "scan_confirm", label: "确认后发布", note: "推荐，用户最后确认" },
  { value: "deep_link", label: "打开平台发布", note: "用户在平台完成发布" },
  { value: "oauth_api", label: "官方 OAuth", note: "需平台能力开通" },
  { value: "extension", label: "本机扩展", note: "登录态只在本机" },
];

function platformLabel(platform: string) {
  return platformOptions.find((item) => item.value === platform)?.label ?? platform;
}

function modeLabel(mode: string) {
  return modeOptions.find((item) => item.value === mode)?.label ?? mode;
}

const socialPlatforms: Array<{
  id: string;
  label: string;
  description: string;
  action: string;
  mode: PublishingAccount["connection_mode"];
  oauth?: boolean;
}> = [
  { id: "douyin", label: "抖音", description: "官方 OAuth，授权一次后可在信息流复用。", action: "授权连接", mode: "oauth_api", oauth: true },
  { id: "xiaohongshu", label: "小红书", description: "预留 OAuth / 官方扫码授权，配置后可复用账号。", action: "授权连接", mode: "oauth_api", oauth: true },
  { id: "kuaishou", label: "快手", description: "预留 OAuth / 官方扫码授权，配置后可复用账号。", action: "授权连接", mode: "oauth_api", oauth: true },
  { id: "zhihu", label: "知乎", description: "预留 OAuth 授权，配置后可复用账号。", action: "授权连接", mode: "oauth_api", oauth: true },
  { id: "bilibili", label: "B站", description: "官方 OAuth，发布权限审核通过后开放。", action: "授权连接", mode: "oauth_api", oauth: true },
  { id: "wechat_channels", label: "视频号", description: "预留微信开放平台扫码授权，配置后可复用账号。", action: "授权连接", mode: "oauth_api", oauth: true },
  { id: "wechat_official", label: "公众号", description: "预留公众号 / 开放平台授权，配置后可复用账号。", action: "授权连接", mode: "oauth_api", oauth: true },
  { id: "tiktok", label: "TikTok", description: "跨境电商 TikTok 内容授权入口。", action: "授权连接", mode: "oauth_api", oauth: true },
  { id: "instagram", label: "Instagram", description: "Instagram Business / Creator 授权入口。", action: "授权连接", mode: "oauth_api", oauth: true },
  { id: "facebook", label: "Facebook", description: "Facebook Page 授权入口。", action: "授权连接", mode: "oauth_api", oauth: true },
  { id: "youtube", label: "YouTube", description: "YouTube 视频与 Shorts 授权入口。", action: "授权连接", mode: "oauth_api", oauth: true },
  { id: "pinterest", label: "Pinterest", description: "Pinterest 商品图钉与目录授权入口。", action: "授权连接", mode: "oauth_api", oauth: true },
  { id: "x", label: "X", description: "X 海外品牌内容授权入口。", action: "授权连接", mode: "oauth_api", oauth: true },
  { id: "x", label: "X", description: "X 海外品牌内容授权入口。", action: "授权连接", mode: "oauth_api", oauth: true },
];
