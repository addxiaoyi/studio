"use client";

import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import Link from "next/link";
import { OperatorContact } from "@/components/operator-contact";
import { PublicInformationPage } from "@/components/public-information-page";

type InquiryForm = { name: string; email: string; company: string; phone: string; message: string };
type Submission = { kind: "idle" | "submitting" } | { kind: "success"; id: string } | { kind: "error"; message: string };
const inputClass = "mt-2 min-h-11 w-full min-w-0 rounded-lg border border-border bg-background px-3 py-2 text-base text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

export default function ContactSalesPage() {
  const [form, setForm] = useState<InquiryForm>({ name: "", email: "", company: "", phone: "", message: "" });
  const [submission, setSubmission] = useState<Submission>({ kind: "idle" });
  const outcome = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (submission.kind === "success" || submission.kind === "error") outcome.current?.focus();
  }, [submission.kind]);

  function updateField(field: keyof InquiryForm) {
    return (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const value = event.target.value;
      setForm(previous => ({ ...previous, [field]: value }));
    };
  }

  async function submitInquiry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submission.kind === "submitting") return;
    setSubmission({ kind: "submitting" });
    try {
      const response = await fetch("/api/contact-sales", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, source: "contact-page" }),
        signal: AbortSignal.timeout(20000),
      });
      const reply = await response.json() as { id?: unknown; error?: { message?: string } };
      if (!response.ok) throw new Error(reply.error?.message ?? "咨询暂时无法提交，请稍后重试或通过邮箱联系。");
      if (typeof reply.id !== "string" || !reply.id) throw new Error("暂未收到咨询编号，请通过客服邮箱核实后再重试。");
      setSubmission({ kind: "success", id: reply.id });
    } catch (error) {
      const timedOut = error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name);
      setSubmission({ kind: "error", message: timedOut ? "提交超时，内容已保留。请通过客服邮箱核实是否收到，避免重复提交。" : error instanceof Error ? error.message : "咨询暂时无法提交，内容已保留。" });
    }
  }

  return (
    <PublicInformationPage title="联系与咨询" summary="可以咨询使用方法、充值账单或团队需求。请描述具体问题，便于核对和回复。">
      <div className="grid min-w-0 gap-10 lg:grid-cols-[0.85fr_1.15fr]">
        <section><h2>直接联系我们</h2><OperatorContact /><p className="mt-5">充值与退款问题请附订单号；生成问题请附任务编号。请勿提供密码、验证码或完整支付账户信息。</p><p className="mt-4">企业定制、报价和服务时限需按需求另行确认。</p><p className="mt-5"><Link href="/refund-policy/">退款与争议处理</Link> · <Link href="/docs/">首发支持范围</Link></p></section>
        <section className="min-w-0">
          <h2>提交咨询</h2>
          {submission.kind === "success" ? (
            <div ref={outcome} role="status" tabIndex={-1} className="rounded-xl border border-border bg-card p-5 focus-visible:outline-2 focus-visible:outline-ring">
              <h3 className="text-lg font-semibold">咨询已保存</h3><p className="mt-3">我们会通过您填写的邮箱回复，请保留以下咨询编号。</p><p className="mt-3 break-all font-mono text-sm">咨询编号：{submission.id}</p>
            </div>
          ) : (
            <form onSubmit={submitInquiry} className="space-y-5" aria-busy={submission.kind === "submitting"}>
              <div className="grid gap-5 sm:grid-cols-2">
                <label className="block text-sm font-medium">姓名<input name="name" autoComplete="name" required maxLength={100} value={form.name} onChange={updateField("name")} className={inputClass} /></label>
                <label className="block text-sm font-medium">联系邮箱<input name="email" autoComplete="email" type="email" required maxLength={254} value={form.email} onChange={updateField("email")} className={inputClass} /></label>
              </div>
              <div className="grid gap-5 sm:grid-cols-2">
                <label className="block text-sm font-medium">公司或团队（选填）<input name="company" autoComplete="organization" maxLength={200} value={form.company} onChange={updateField("company")} className={inputClass} /></label>
                <label className="block text-sm font-medium">电话（选填）<input name="phone" autoComplete="tel" type="tel" maxLength={50} value={form.phone} onChange={updateField("phone")} className={inputClass} /></label>
              </div>
              <label className="block text-sm font-medium">问题或需求<textarea name="message" required minLength={10} maxLength={2000} rows={6} aria-describedby="inquiry-help" value={form.message} onChange={updateField("message")} className={inputClass} /></label>
              <p id="inquiry-help" className="text-sm">请填写 10–2000 字，可附订单号、任务编号和问题发生时间。</p>
              {submission.kind === "error" && <div ref={outcome} role="alert" tabIndex={-1} className="rounded-lg border border-destructive/30 p-3 text-sm text-destructive focus-visible:outline-2 focus-visible:outline-ring">{submission.message}</div>}
              <button type="submit" disabled={submission.kind === "submitting"} className="inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-foreground px-4 py-3 text-base font-medium text-background disabled:cursor-wait disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring">{submission.kind === "submitting" ? "正在提交…" : "提交咨询"}</button>
              <p className="text-sm">提交的信息仅用于处理咨询，详见<Link href="/privacy/">隐私政策</Link>。</p>
            </form>
          )}
        </section>
      </div>
    </PublicInformationPage>
  );
}
