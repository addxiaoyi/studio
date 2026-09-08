"use client";

import Link from "next/link";
import { HelsteraLogo } from "@/components/icons/helstera-logo";

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-background">
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

      <div className="mx-auto max-w-4xl px-6 py-32">
        <p className="eyebrow">法律文档</p>
        <h1 className="display-lg mt-5 text-foreground">服务条款</h1>
        <p className="text-sm text-muted-foreground/80 font-light mt-5">
          更新日期：2026 年 1 月 1 日
        </p>

        <div className="prose prose-neutral max-w-none space-y-12 mt-16">
          <section>
            <h2 className="text-lg font-medium text-foreground tracking-tight mb-4">
              1. 服务说明
            </h2>
            <p className="text-muted-foreground leading-relaxed font-light">
              Helstera 是一个企业级 AI 设计平台，提供品牌管理、画布协作和多模态内容生成服务。我们持续改进服务，保留在不事先通知的情况下调整功能、价格和配额的权利。
            </p>
          </section>

          <section>
            <h2 className="text-xl font-medium mb-3">2. 账户与使用</h2>
            <p className="text-muted-foreground leading-relaxed">
              您需保证账户信息的准确性和安全性。企业用户须确保获得使用 AI 工具的合法授权。您同意不利用服务从事任何违法、侵权或损害第三方利益的活动。
            </p>
          </section>

          <section>
            <h2 className="text-xl font-medium mb-3">3. 知识产权</h2>
            <p className="text-muted-foreground leading-relaxed">
              您保留对您通过 Helstera 创建的品牌套件、画布内容和提示词的所有权。AI 生成内容的所有权归属取决于您的订阅计划：个人版生成内容归您所有；企业版提供更完整的商业授权。请参阅您的具体计划说明。
            </p>
          </section>

          <section>
            <h2 className="text-xl font-medium mb-3">4. 积分与计费</h2>
            <p className="text-muted-foreground leading-relaxed">
              积分用于兑换 AI 生成服务，不可转让、退款或兑换现金。订阅按月/年计费，提前取消可于当前计费周期结束后生效，未使用积分在订阅到期后失效。免费套餐积分有效期为 30 天。
            </p>
          </section>

          <section>
            <h2 className="text-xl font-medium mb-3">5. 水印</h2>
            <p className="text-muted-foreground leading-relaxed">
              根据您的订阅计划，AI 生成内容可能包含或不包含 Helstera 水印。企业版客户可在管理后台关闭水印。免费用户的所有生成内容均附带水印。
            </p>
          </section>

          <section>
            <h2 className="text-xl font-medium mb-3">6. 免责声明</h2>
            <p className="text-muted-foreground leading-relaxed">
              Helstera 按「现状」提供服务，不对生成内容的准确性、适用性或版权合规性作出保证。您在使用 AI 生成内容时须自行承担合规审查责任。因不可抗力导致的服务中断，我们不承担责任。
            </p>
          </section>

          <section>
            <h2 className="text-xl font-medium mb-3">7. 联系我们</h2>
            <p className="text-muted-foreground leading-relaxed">
              如有疑问，请联系：<a href="mailto:legal@helstera.com" className="text-accent underline">legal@helstera.com</a>
            </p>
          </section>
        </div>
        </div>
      </main>
    </div>
  );
}
