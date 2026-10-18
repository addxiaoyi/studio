"use client";

import Link from "next/link";
import { ArrowRight, Check, X } from "lucide-react";
import { useEffect, useState } from "react";

const STORAGE_KEY = "helstera:first-run-guide:v1";

const steps = [
  { title: "建立品牌基础", body: "上传 Logo、颜色和品牌语气，让后续内容保持一致。", href: "/brand-kit", action: "配置品牌资产" },
  { title: "完成第一次创作", body: "输入一个商品或创意，先生成一张可继续编辑的结果。", href: "/create", action: "开始创作" },
  { title: "把内容变成增长", body: "从选题、脚本到平台适配，建立可复用的内容包。", href: "/feed", action: "打开增长工作台" },
] as const;

export function HomeFirstRunGuide() {
  const [visible, setVisible] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    setVisible(window.localStorage.getItem(STORAGE_KEY) !== "completed");
  }, []);

  function complete() {
    window.localStorage.setItem(STORAGE_KEY, "completed");
    setVisible(false);
  }

  function next() {
    if (step >= steps.length - 1) complete();
    else setStep((current) => current + 1);
  }

  if (!visible) return null;
  const current = steps[step]!;

  return (
    <section aria-labelledby="first-run-guide-title" className="my-6 w-full rounded-xl border border-foreground/15 bg-foreground/[0.04] p-5 sm:p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">GET STARTED</p>
          <h2 id="first-run-guide-title" className="mt-2 text-lg font-medium tracking-tight">三步建立你的创作工作台</h2>
        </div>
        <button type="button" onClick={complete} aria-label="关闭引导" className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"><X className="size-4" /></button>
      </div>
      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        {steps.map((item, index) => (
          <div key={item.title} className={`rounded-lg border p-4 ${index === step ? "border-foreground/30 bg-background" : "border-border/60 bg-background/40"}`}>
            <div className="flex items-center gap-2">
              <span className="grid size-6 place-items-center rounded-full border text-[11px] font-medium">{index < step ? <Check className="size-3.5" /> : index + 1}</span>
              <p className="text-xs font-semibold">{item.title}</p>
            </div>
            <p className="mt-3 min-h-10 text-xs leading-5 text-muted-foreground">{item.body}</p>
            {index === step && <Link href={item.href} onClick={next} className="mt-4 inline-flex items-center gap-1 text-xs font-medium underline underline-offset-2">{item.action}<ArrowRight className="size-3.5" /></Link>}
          </div>
        ))}
      </div>
      <div className="mt-4 flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <span>第 {step + 1} 步，共 {steps.length} 步</span>
        <button type="button" onClick={next} className="font-medium text-foreground underline underline-offset-2">{step === steps.length - 1 ? "完成引导" : "跳过当前步骤"}</button>
      </div>
    </section>
  );
}
