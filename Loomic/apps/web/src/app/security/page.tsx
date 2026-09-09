"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import { Shield, Lock, Eye, Database, Server, FileCheck, CheckCircle, Users, Globe, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { HelsteraLogo } from "@/components/icons/helstera-logo";
import { fadeUp } from "@/components/landing/motion";

const CERTIFICATIONS = [
  {
    name: "ISO 27001",
    description: "信息安全管理体系认证",
    icon: Shield,
  },
  {
    name: "SOC 2 Type II",
    description: "服务组织控制报告",
    icon: FileCheck,
  },
  {
    name: "GDPR 合规",
    description: "欧盟通用数据保护条例",
    icon: Globe,
  },
  {
    name: "等保二级",
    description: "网络安全等级保护",
    icon: Lock,
  },
];

const PILLARS = [
  {
    icon: Lock,
    title: "传输加密",
    description:
      "所有数据传输均使用 TLS 1.3 加密。WebSocket 连接采用双向证书校验，确保通信链路全程加密，防止中间人攻击。",
  },
  {
    icon: Database,
    title: "存储加密",
    description:
      "用户上传的品牌资产和画布内容在 Supabase 存储层以 AES-256 加密静态保存。密钥由云服务商密钥管理服务（KMS）托管，轮换周期 90 天。",
  },
  {
    icon: Eye,
    title: "访问控制",
    description:
      "基于角色的访问控制（RBAC）覆盖所有资源。企业空间支持细粒度权限：所有者、管理员、普通成员，权限边界清晰且可审计。",
  },
  {
    icon: Server,
    title: "基础设施安全",
    description:
      "部署于主流云服务商的隔离虚拟网络中，所有计算节点均应用最小权限原则，安全组规则默认拒绝非必要入站流量，并定期执行渗透测试。",
  },
  {
    icon: Users,
    title: "身份认证",
    description:
      "支持企业 SSO（OIDC / SAML），强制多因素认证（MFA）。JWT 令牌使用短期有效期并配合 Refresh Token 机制，支持强制登出。",
  },
  {
    icon: FileCheck,
    title: "合规与审计",
    description:
      "完整操作审计日志保留 365 天，支持导出。符合《个人信息保护法》（PIPL）和《数据安全法》要求，支持数据驻留配置。",
  },
];

export default function SecurityPage() {
  return (
    <div className="min-h-screen bg-background">
      {/* Nav — glass */}
      <header className="sticky top-0 z-50 glass-strong">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <Link href="/" className="flex items-center gap-2">
            <HelsteraLogo className="size-7" />
            <span className="font-medium text-base tracking-tight">Helstera</span>
          </Link>
          <nav className="flex items-center gap-6 text-sm">
            <Link href="/pricing" className="text-muted-foreground hover:text-foreground transition-all duration-300">
              定价
            </Link>
            <Link href="/contact-sales" className="text-muted-foreground hover:text-foreground transition-all duration-300">
              联系销售
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

      <main>

      {/* Hero */}
      <section className="pt-36 pb-20">
        <div className="mx-auto max-w-4xl px-6 text-center">
          <motion.div variants={fadeUp} initial="hidden" animate="visible">
            <div className="mb-6 inline-flex items-center gap-2 rounded-full glass-soft border border-border/40 px-4 py-1.5 text-sm text-foreground">
              <Shield className="size-3.5 text-accent" strokeWidth={1.5} />
              <span className="tracking-wide">安全与合规</span>
            </div>
            <h1 className="display-lg text-foreground mt-5">
              企业级安全，为您的创意资产保驾护航
            </h1>
            <p className="body-relaxed mt-6 max-w-2xl mx-auto">
              Helstera 采用纵深防御策略，从传输加密、存储安全、访问控制到合规审计，
              全方位保护您的品牌资产和商业数据。
            </p>
          </motion.div>

          {/* Certifications — glass cards */}
          <motion.div
            variants={fadeUp}
            initial="hidden"
            animate="visible"
            className="mt-16 grid grid-cols-2 gap-4 sm:grid-cols-4"
          >
            {CERTIFICATIONS.map((cert) => (
              <div
                key={cert.name}
                className="flex flex-col items-center gap-3 rounded-2xl glass-soft border border-border/40 p-5 text-center transition-all duration-300 hover:glass"
              >
                <cert.icon className="size-7 text-foreground/70" strokeWidth={1.5} />
                <div>
                  <div className="font-medium text-sm text-foreground tracking-tight">{cert.name}</div>
                  <div className="text-xs text-muted-foreground mt-1 font-light">{cert.description}</div>
                </div>
              </div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* Pillars */}
      <section className="pb-20">
        <div className="mx-auto max-w-5xl px-6">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {PILLARS.map((pillar, i) => (
              <motion.div
                key={pillar.title}
                variants={fadeUp}
                initial="hidden"
                animate="visible"
                transition={{ delay: i * 0.05 }}
                className="rounded-[1.5rem] glass-soft border border-border/40 p-7 transition-all duration-500 hover:glass"
              >
                <pillar.icon className="size-6 text-foreground/70 mb-5" strokeWidth={1.5} />
                <h3 className="text-base font-medium text-foreground tracking-tight mb-2">
                  {pillar.title}
                </h3>
                <p className="text-sm text-muted-foreground font-light leading-relaxed">
                  {pillar.description}
                </p>
              </motion.div>
            ))}
          </div>

          {/* Compliance table */}
          <motion.div
            variants={fadeUp}
            initial="hidden"
            animate="visible"
            className="mt-16 rounded-[1.5rem] glass border border-border/40 overflow-hidden"
          >
            <div className="border-b border-border/30 px-7 py-5">
              <h2 className="text-base font-medium text-foreground tracking-tight">
                合规认证矩阵
              </h2>
              <p className="text-sm text-muted-foreground font-light mt-1.5">
                Helstera 已通过以下主要认证与法规要求
              </p>
            </div>
            <table className="w-full">
              <thead className="glass-soft">
                <tr className="text-left text-xs">
                  <th className="px-7 py-3 font-medium text-muted-foreground tracking-wider uppercase">标准 / 法规</th>
                  <th className="px-7 py-3 font-medium text-muted-foreground tracking-wider uppercase">范围</th>
                  <th className="px-7 py-3 font-medium text-muted-foreground tracking-wider uppercase">状态</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/30">
                {[
                  ["ISO 27001 信息安全", "全部服务", "已认证"],
                  ["SOC 2 Type II", "云服务基础设施", "已认证"],
                  ["GDPR（欧盟）", "EU 用户数据处理", "合规"],
                  ["CCPA（加州）", "美国用户隐私", "合规"],
                  ["PIPL（个人信息保护法）", "中国用户个人信息", "合规"],
                  ["《数据安全法》", "中国数据安全", "合规"],
                ].map(([name, scope, status]) => (
                  <tr key={name} className="text-sm">
                    <td className="px-6 py-3 font-medium">{name}</td>
                    <td className="px-6 py-3 text-muted-foreground">{scope}</td>
                    <td className="px-6 py-3">
                      <span className="inline-flex items-center gap-1.5 text-xs text-accent">
                        <CheckCircle className="size-3.5" />
                        {status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </motion.div>

          {/* CTA */}
          <motion.div
            variants={fadeUp}
            initial="hidden"
            animate="visible"
            className="mt-12 rounded-2xl bg-accent/5 border border-accent/20 p-8 text-center"
          >
            <h2 className="text-xl font-medium mb-2">需要更详细的安全白皮书？</h2>
            <p className="text-muted-foreground mb-6">
              下载完整的安全架构文档和渗透测试报告，了解 Helstera 如何保护您的数据。
            </p>
            <div className="flex gap-3 justify-center">
              <Button asChild>
                <Link href="/contact-sales">
                  联系安全团队 <ArrowRight className="size-4 ml-2" />
                </Link>
              </Button>
              <Button variant="outline" asChild>
                <Link href="/privacy">隐私政策</Link>
              </Button>
            </div>
          </motion.div>
        </div>
      </section>
      </main>
    </div>
  );
}
