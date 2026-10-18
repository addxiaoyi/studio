import Link from "next/link";

export default function NewFeaturesGuidePage() {
  return (
    <main className="mx-auto min-h-full w-full max-w-4xl px-6 py-10">
      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <p className="eyebrow">使用文档</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">新增功能使用说明</h1>
          <p className="mt-3 text-sm text-muted-foreground">模型、资产和智能体功能的计费与使用规则。</p>
        </div>
        <Link href="/home" className="text-sm text-muted-foreground transition-colors hover:text-foreground">返回工作台</Link>
      </div>

      <section className="space-y-4 rounded-2xl border border-border/60 bg-card/60 p-6 shadow-card">
        <h2 className="text-lg font-medium">💬 对话智能体</h2>
        <p className="text-sm leading-6 text-muted-foreground">
          对话模型按其标注单位计费。默认模型 Agnes 3.0 Flash 的价格为 <strong className="text-foreground">¥0.50 / 百万 tokens</strong>；HY3（hy3）及兼容路由的价格为 <strong className="text-foreground">¥0.01 / 条消息</strong>。
          模型选择器中的价格标注为最终用户价格。
        </p>
        <ul className="space-y-2 text-sm text-muted-foreground">
          <li>✅ 发送前检查余额，余额不足时不会创建任务。</li>
          <li>↩️ 智能体任务失败会自动退回本条消息费用。</li>
          <li>🔒 价格由服务端校验，不能通过修改浏览器页面绕过。</li>
        </ul>
      </section>

      <section className="mt-5 space-y-4 rounded-2xl border border-border/60 bg-card/60 p-6 shadow-card">
        <h2 className="text-lg font-medium">🎨 图片与视频创作</h2>
        <p className="text-sm leading-6 text-muted-foreground">
          图片按张计费，视频按次或按秒计费，Token 模型按输入与输出 Token 分开计费。
          所有金额以创作页面和模型选择器显示的最终价格为准。
        </p>
      </section>
    </main>
  );
}
