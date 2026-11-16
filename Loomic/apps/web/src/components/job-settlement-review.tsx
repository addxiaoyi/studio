"use client";

import { useLocale } from "@/lib/i18n";
import { decideJobSettlement } from "@/lib/server-api";
import type { SettlementReview } from "@helstera/shared";
import { useEffect, useRef, useState } from "react";

type JobSettlementReviewProps = {
  userId: string;
  token: string;
  jobId: string;
  review: SettlementReview;
  onUpdated: () => Promise<void> | void;
};

export function JobSettlementReview(props: JobSettlementReviewProps) {
  const scope = JSON.stringify([
    props.userId,
    props.token,
    props.jobId,
    props.review.id,
  ]);
  return <SettlementDecision key={scope} {...props} />;
}

function SettlementDecision({
  token,
  jobId,
  review,
  onUpdated,
}: JobSettlementReviewProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const active = useRef(false);
  const pending = useRef(false);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const english = useLocale() === "en-US";
  const copy = english
    ? {
        title: "Usage exceeds the approved amount",
        label: "Additional charge approval",
        credits: "credits",
        original: "Reserved",
        total: "Total",
        extra: "Additional charge",
        explanation:
          "This confirms only the difference for the existing result. It does not generate again.",
        rejected:
          "Additional charge declined. The result and original reservation are retained; you can confirm again here.",
        approved:
          "Approval saved. If your balance is insufficient, top up and retry settlement.",
        completed: "The difference is settled. You can retrieve the result.",
        processing: "Processing…",
        retry: "Retry settlement",
        confirm: "Confirm additional",
        reject: "Decline additional charge",
        failed: "Unable to confirm the charge. Please retry.",
      }
    : {
        title: "本次用量超出原确认金额",
        label: "额外费用确认",
        credits: "积分",
        original: "原预扣",
        total: "本次总额",
        extra: "需补扣",
        explanation: "确认只结算已生成结果的差额，不会重新调用模型。",
        rejected: "已拒绝补扣。原结果和预扣记录保留，可在此重新确认。",
        approved: "确认已保存；若余额不足，可充值后重试结算。",
        completed: "费用差额已结算，可继续取回结果。",
        processing: "正在处理…",
        retry: "重试结算差额",
        confirm: "确认补扣",
        reject: "拒绝补扣",
        failed: "费用确认失败，请重试。",
      };
  async function decide(decision: "approve" | "reject") {
    if (pending.current || !active.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      await decideJobSettlement(token, jobId, review.id, decision);
      if (active.current) await onUpdated();
    } catch (cause) {
      if (active.current)
        setError(cause instanceof Error ? cause.message : copy.failed);
    } finally {
      pending.current = false;
      if (active.current) setBusy(false);
    }
  }
  const approve = () => void decide("approve");
  const reject = () => void decide("reject");
  if (review.status === "consumed")
    return (
      <output className="text-xs text-muted-foreground">
        {copy.completed}
      </output>
    );
  return (
    <section
      aria-label={copy.label}
      className="space-y-3 rounded-lg border border-border bg-background p-3 text-sm"
    >
      <h4 className="font-medium">{copy.title}</h4>
      <p>
        {copy.original} {review.reservedCredits} {copy.credits} · {copy.total}{" "}
        {review.actualCost} {copy.credits} · {copy.extra}{" "}
        <strong>
          {review.additionalCredits} {copy.credits}
        </strong>
      </p>
      <p className="text-xs text-muted-foreground">{copy.explanation}</p>
      {review.status === "rejected" && <output>{copy.rejected}</output>}
      {review.status === "approved" && <output>{copy.approved}</output>}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={approve}
          className="min-h-9 rounded-md bg-primary px-3 text-primary-foreground disabled:opacity-50"
        >
          {busy
            ? copy.processing
            : review.status === "approved"
              ? copy.retry
              : `${copy.confirm} ${review.additionalCredits} ${copy.credits}`}
        </button>
        {review.status === "pending" && (
          <button
            type="button"
            disabled={busy}
            onClick={reject}
            className="min-h-9 rounded-md border border-border px-3 disabled:opacity-50"
          >
            {copy.reject}
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
