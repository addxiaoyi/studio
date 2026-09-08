"use client";

import Link from "next/link";
import { HelsteraLogo } from "@/components/icons/helstera-logo";

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-background">
      {/* Nav — glass */}
      <header className="sticky top-0 z-50 glass-strong">
        <div className="mx-auto flex h-16 max-w-4xl items-center justify-between px-6">
          <Link href="/" className="flex items-center gap-2">
            <HelsteraLogo className="size-7" />
            <span className="font-medium text-base tracking-tight">Helstera</span>
          </Link>
          <Link
            href="/login"
            className="inline-flex items-center px-4 h-8 rounded-full border border-border/40 text-foreground text-sm font-medium glass-soft hover:glass transition-all"
          >
            登录
          </Link>
        </div>
      </header>

      <main>

      {/* Content */}
      <div className="mx-auto max-w-4xl px-6 py-32">
        <p className="eyebrow">法律文档</p>
        <h1 className="display-lg mt-5 text-foreground">隐私政策</h1>
        <p className="text-sm text-muted-foreground/80 font-light mt-5">
          更新日期：2026 年 1 月 1 日
        </p>

        <div className="prose prose-neutral max-w-none space-y-12 mt-16">
          <section>
            <h2 className="text-lg font-medium text-foreground tracking-tight mb-4">
              1. 信息收集
            </h2>
            <p className="text-muted-foreground leading-relaxed font-light">
              Helstera（「我们」）收集您在使用服务时主动提供的信息，包括账户注册信息（姓名、邮箱）、工作空间配置、品牌套件内容、画布数据以及使用日志。我们还收集设备信息和 IP 地址以提升服务安全性和稳定性。所有敏感数据在传输和存储时均经过加密处理。
            </p>
          </section>

          <section>
            <h2 className="text-xl font-medium mb-3">2. 信息使用</h2>
            <p className="text-muted-foreground leading-relaxed">
              我们使用收集的信息用于：提供和改进 AI 生成服务、处理您的账户和付款、保障服务安全、发送服务通知以及合规用途。未经您同意，我们不会将您的个人信息用于广告推送或转让给第三方用于商业目的。
            </p>
          </section>

          <section>
            <h2 className="text-xl font-medium mb-3">3. 数据存储与安全</h2>
            <p className="text-muted-foreground leading-relaxed">
              您的数据存储在位于中国大陆及境外的云服务基础设施中。我们采用行业标准的安全措施，包括 TLS 加密传输、AES-256 静态加密、访问控制和定期安全审计。您的品牌资产和画布内容受我们服务条款的保护，未经法律程序不会向第三方披露。
            </p>
          </section>

          <section>
            <h2 className="text-xl font-medium mb-3">4. 您的权利</h2>
            <p className="text-muted-foreground leading-relaxed">
              您有权访问、更正或删除您的个人数据。您可以通过账户设置导出数据，或联系 <a href="mailto:privacy@helstera.com" className="text-accent underline">privacy@helstera.com</a> 行使数据主体权利。企业用户可联系其账户管理员行使团队数据相关权利。
            </p>
          </section>

          <section>
            <h2 className="text-xl font-medium mb-3">5. 儿童隐私</h2>
            <p className="text-muted-foreground leading-relaxed">
              Helstera 不面向 14 岁以下儿童，也不故意收集儿童个人信息。如您发现未成年人未经监护人同意使用了我们的服务，请联系我们予以删除。
            </p>
          </section>

          <section>
            <h2 className="text-xl font-medium mb-3">6. 政策变更</h2>
            <p className="text-muted-foreground leading-relaxed">
              我们可能不时更新本隐私政策。重大变更将通过电子邮件或服务内通知告知您。继续使用服务即表示您接受更新后的政策。
            </p>
          </section>

          <section>
            <h2 className="text-xl font-medium mb-3">7. 联系我们</h2>
            <p className="text-muted-foreground leading-relaxed">
              如对本隐私政策有任何疑问，请联系：<br />
              邮箱：<a href="mailto:privacy@helstera.com" className="text-accent underline">privacy@helstera.com</a><br />
              地址：北京市朝阳区光华路 10 号院
            </p>
          </section>
        </div>
        </div>
      </main>
    </div>
  );
}
