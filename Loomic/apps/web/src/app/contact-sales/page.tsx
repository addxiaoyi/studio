"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import {
  Send,
  Building2,
  Phone,
  Mail,
  CheckCircle,
  ArrowRight,
  Sparkles,
  AlertCircle,
} from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { HelsteraLogo } from "@/components/icons/helstera-logo";
import { fadeUp } from "@/components/landing/motion";
import { cn } from "@/lib/utils";

type SubmitState =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "success"; id: string }
  | { kind: "error"; message: string };

const PLANS = [
  {
    name: "团队版",
    price: "¥3,980",
    period: "/月",
    description: "适合 10 人以内的设计团队",
    features: [
      "10 位团队成员",
      "无限品牌套件",
      "优先生成队列",
      "标准 API 调用",
      "邮件支持",
    ],
  },
  {
    name: "企业版",
    price: "¥9,800",
    period: "/月",
    description: "适合中大型组织的完整解决方案",
    features: [
      "无限团队成员",
      "私有化部署选项",
      "专属客户成功经理",
      "无限 API 调用",
      "SLA 保障 + 24/7 支持",
      "SSO / SAML",
      "审计日志",
    ],
    highlighted: true,
  },
  {
    name: "定制版",
    price: "来电询价",
    period: "",
    description: "满足特殊合规和安全要求",
    features: [
      "私有云 / 本地部署",
      "定制 AI 模型接入",
      "专属研发支持",
      "定制 SLA 协议",
      "数据驻留方案",
    ],
  },
];

export default function ContactSalesPage() {
  const [state, setState] = useState<SubmitState>({ kind: "idle" });
  const [form, setForm] = useState({
    name: "",
    email: "",
    company: "",
    phone: "",
    teamSize: "",
    message: "",
  });

  function update(field: keyof typeof form) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setForm((prev) => ({ ...prev, [field]: e.target.value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setState({ kind: "submitting" });
    try {
      const res = await fetch("/api/contact-sales", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          source: "pricing-page",
        }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as {
          error?: { message?: string };
        };
        throw new Error(err.error?.message ?? "提交失败");
      }
      const data = (await res.json()) as { id: string };
      setState({ kind: "success", id: data.id });
    } catch (err) {
      setState({
        kind: "error",
        message: err instanceof Error ? err.message : "提交失败，请稍后重试。",
      });
    }
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Nav — glass */}
      <header className="fixed top-0 inset-x-0 z-50 glass-strong">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <Link href="/" className="flex items-center gap-2">
            <HelsteraLogo className="size-7" />
            <span className="font-medium text-base tracking-tight">Helstera</span>
          </Link>
          <nav className="flex items-center gap-6 text-sm">
            <Link
              href="/pricing"
              className="text-muted-foreground hover:text-foreground transition-all duration-300"
            >
              定价
            </Link>
            <Link
              href="/security"
              className="text-muted-foreground hover:text-foreground transition-all duration-300"
            >
              安全合规
            </Link>
            <Link
              href="/login"
              className="inline-flex items-center px-4 h-8 rounded-full bg-foreground text-background text-sm font-medium transition-all hover:scale-[1.02]"
            >
              登录
            </Link>
          </nav>
        </div>
      </header>

      {/* Atmospheric glow */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[60vh] -z-10 overflow-hidden">
        <div
          className="absolute -top-1/4 left-1/2 w-[80vw] h-[80vw] -translate-x-1/2 rounded-full opacity-40"
          style={{
            background:
              "radial-gradient(ellipse at center, oklch(var(--primary) / 0.08) 0%, transparent 65%)",
          }}
        />
      </div>

      <main className="pt-36 pb-32">
        <div className="mx-auto max-w-6xl px-6">
          {/* Section Header — Editorial style. h1 stays outside motion.div
              so screen readers + axe see a visible level-one heading. */}
          <span className="eyebrow">企业咨询</span>
          <h1 className="display-lg mt-5 text-foreground">
            与企业销售团队对话
          </h1>
          <motion.div
            {...fadeUp}
            initial="hidden"
            animate="visible"
            className="mt-6"
          >
            <p className="body-relaxed max-w-2xl">
              告诉我们您的团队规模和需求，我们将在 24 小时内为您定制最合适的
              Helstera 方案——从私有化部署到定制 AI 模型。
            </p>
          </motion.div>

          <div className="grid gap-12 lg:grid-cols-[1.05fr_1fr] lg:gap-16">
            {/* Left: Plans + Contact */}
            <div className="space-y-4">
              {PLANS.map((plan) => (
                <motion.div
                  key={plan.name}
                  {...fadeUp}
                  initial="hidden"
                  animate="visible"
                  className={cn(
                    "rounded-[1.5rem] p-7 transition-all duration-500",
                    plan.highlighted
                      ? "glass border border-foreground/20 shadow-card"
                      : "glass-soft border border-border/40",
                  )}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h3 className="text-base font-medium text-foreground tracking-tight">
                        {plan.name}
                      </h3>
                      <p className="mt-1 text-sm text-muted-foreground font-light">
                        {plan.description}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-2xl font-light text-foreground tabular-nums tracking-tight">
                        {plan.price}
                      </div>
                      {plan.period && (
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {plan.period}
                        </div>
                      )}
                    </div>
                  </div>
                  <ul className="mt-6 space-y-3">
                    {plan.features.map((f) => (
                      <li
                        key={f}
                        className="flex items-start gap-3 text-sm text-foreground/80 font-light"
                      >
                        <CheckCircle
                          className="size-3.5 text-accent shrink-0 mt-0.5"
                          strokeWidth={2}
                        />
                        {f}
                      </li>
                    ))}
                  </ul>
                </motion.div>
              ))}

              {/* Contact info — glass card */}
              <motion.div
                {...fadeUp}
                initial="hidden"
                animate="visible"
                className="mt-6 rounded-[1.5rem] glass-soft border border-border/40 p-7"
              >
                <h3 className="text-sm font-medium text-foreground tracking-tight">
                  其他联系方式
                </h3>
                <div className="mt-5 space-y-4">
                  <a
                    href="mailto:enterprise@helstera.com"
                    className="flex items-center gap-3 text-sm text-muted-foreground hover:text-foreground transition-all duration-300"
                  >
                    <Mail className="size-4 opacity-60" strokeWidth={1.5} />
                    enterprise@helstera.com
                  </a>
                  <a
                    href="tel:+86-400-888-9999"
                    className="flex items-center gap-3 text-sm text-muted-foreground hover:text-foreground transition-all duration-300"
                  >
                    <Phone className="size-4 opacity-60" strokeWidth={1.5} />
                    400-888-9999
                  </a>
                  <div className="flex items-center gap-3 text-sm text-muted-foreground">
                    <Building2 className="size-4 opacity-60" strokeWidth={1.5} />
                    北京市朝阳区光华路 10 号院
                  </div>
                </div>
              </motion.div>
            </div>

            {/* Right: Form — glass card */}
            <motion.div {...fadeUp} initial="hidden" animate="visible">
              <div className="rounded-[1.5rem] glass border border-border/40 p-8 sticky top-28">
                {state.kind === "success" ? (
                  <div className="flex flex-col items-center gap-5 py-16 text-center">
                    <div className="rounded-full glass-soft border border-accent/30 p-4 accent-glow">
                      <CheckCircle
                        className="size-8 text-accent"
                        strokeWidth={1.5}
                      />
                    </div>
                    <div>
                      <h2 className="display-sm text-foreground">已收到您的请求</h2>
                      <p className="mt-3 text-muted-foreground text-sm font-light leading-relaxed max-w-sm mx-auto">
                        企业销售团队将在 24 小时内通过邮件联系您，请注意查收。
                      </p>
                    </div>
                    <Link
                      href="/"
                      className="mt-2 inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-medium glass-soft hover:glass border border-border/40 transition-all"
                    >
                      返回首页
                      <ArrowRight className="size-3.5" />
                    </Link>
                  </div>
                ) : (
                  <>
                    {/* Eyebrow */}
                    <div className="flex items-center gap-2 mb-3">
                      <Sparkles className="size-3.5 text-accent" strokeWidth={1.5} />
                      <span className="eyebrow">开始咨询</span>
                    </div>
                    <h2 className="display-sm text-foreground">填写咨询表单</h2>
                    <p className="mt-3 text-sm text-muted-foreground font-light">
                      所有信息保密，仅用于为您设计专属方案。
                    </p>

                    <form onSubmit={handleSubmit} className="mt-8 space-y-5">
                      <div className="grid gap-5 sm:grid-cols-2">
                        <div className="space-y-2.5">
                          <Label htmlFor="name">姓名</Label>
                          <Input
                            id="name"
                            required
                            value={form.name}
                            onChange={update("name")}
                            placeholder="您的姓名"
                          />
                        </div>
                        <div className="space-y-2.5">
                          <Label htmlFor="email">工作邮箱</Label>
                          <Input
                            id="email"
                            type="email"
                            required
                            value={form.email}
                            onChange={update("email")}
                            placeholder="you@company.com"
                          />
                        </div>
                      </div>

                      <div className="grid gap-5 sm:grid-cols-2">
                        <div className="space-y-2.5">
                          <Label htmlFor="company">公司名称</Label>
                          <Input
                            id="company"
                            required
                            value={form.company}
                            onChange={update("company")}
                            placeholder="公司全称"
                          />
                        </div>
                        <div className="space-y-2.5">
                          <Label htmlFor="phone">联系电话</Label>
                          <Input
                            id="phone"
                            type="tel"
                            value={form.phone}
                            onChange={update("phone")}
                            placeholder="+86 xxx xxxx xxxx"
                          />
                        </div>
                      </div>

                      <div className="space-y-2.5">
                        <Label htmlFor="teamSize">团队规模</Label>
                        <select
                          id="teamSize"
                          value={form.teamSize}
                          onChange={update("teamSize")}
                          className="flex h-9 w-full rounded-lg border border-input bg-transparent px-3 py-1.5 text-sm transition-all duration-300 outline-none file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
                        >
                          <option value="">请选择</option>
                          <option value="1-10">1-10 人</option>
                          <option value="11-50">11-50 人</option>
                          <option value="51-200">51-200 人</option>
                          <option value="201-500">201-500 人</option>
                          <option value="500+">500 人以上</option>
                        </select>
                      </div>

                      <div className="space-y-2.5">
                        <Label htmlFor="message">您的需求</Label>
                        <Textarea
                          id="message"
                          value={form.message}
                          onChange={update("message")}
                          placeholder="请描述您的团队规模、使用场景、具体需求…"
                          rows={4}
                        />
                      </div>

                      <button
                        type="submit"
                        disabled={state.kind === "submitting"}
                        className={cn(
                          "mt-2 w-full inline-flex items-center justify-center gap-2 rounded-full bg-foreground text-background h-10 px-5 text-sm font-medium transition-all duration-300 hover:scale-[1.01] active:scale-[0.99] disabled:opacity-60 disabled:hover:scale-100",
                        )}
                      >
                        {state.kind === "submitting" ? (
                          <>
                            <span className="size-3.5 rounded-full border-2 border-background/30 border-t-background animate-spin" />
                            正在提交...
                          </>
                        ) : (
                          <>
                            <Send className="size-3.5" strokeWidth={1.5} />
                            提交咨询
                          </>
                        )}
                      </button>

                      {state.kind === "error" && (
                        <div
                          role="alert"
                          className="mt-2 flex items-start gap-2 rounded-2xl glass-soft border border-destructive/30 px-4 py-3 text-sm text-destructive"
                        >
                          <AlertCircle
                            className="size-4 shrink-0 mt-0.5"
                            strokeWidth={1.5}
                          />
                          <span className="font-light leading-relaxed">
                            {state.message}
                          </span>
                        </div>
                      )}

                      <p className="text-center text-xs text-muted-foreground/80 font-light">
                        提交即表示您同意我们的{" "}
                        <Link
                          href="/privacy"
                          className="underline hover:text-foreground transition-all duration-300 underline-offset-2"
                        >
                          隐私政策
                        </Link>
                      </p>
                    </form>
                  </>
                )}
              </div>
            </motion.div>
          </div>
        </div>
      </main>
    </div>
  );
}
