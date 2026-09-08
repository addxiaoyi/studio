// @credits-system — Usage history table showing credit transactions
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Zap } from "lucide-react";

import { useAuth } from "@/lib/auth-context";
import { fetchCreditTransactions, type CreditTransaction } from "@/lib/credits-api";
import { LoadingState } from "@/components/loading-state";

// ── Transaction type labels ──────────────────────────────────

const TYPE_LABELS: Record<string, string> = {
  topup: "充值到账",
  generation_deduct: "生成扣费",
  generation_refund: "生成退款",
  admin_adjustment: "管理员调整",
  bonus: "赠送积分",
};

type FilterMode = "all" | "deducted" | "granted";

const FILTER_OPTIONS: Array<{ value: FilterMode; label: string }> = [
  { value: "all", label: "All" },
  { value: "deducted", label: "Deducted" },
  { value: "granted", label: "Granted" },
];

const DEDUCT_TYPES = new Set(["generation_deduct"]);
const GRANT_TYPES = new Set([
  "subscription_grant",
  "daily_grant",
  "purchase",
  "generation_refund",
  "admin_adjustment",
  "bonus",
]);

// ── Page size ────────────────────────────────────────────────

const PAGE_SIZE = 20;

// ── Helpers ──────────────────────────────────────────────────

function formatDate(iso: string | number): string {
  const d = new Date(typeof iso === "number" && iso < 1e12 ? iso * 1000 : iso);
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ── Main component ───────────────────────────────────────────

export function CreditUsageHistory() {
  const { session } = useAuth();
  const accessTokenRef = useRef(session?.access_token);
  accessTokenRef.current = session?.access_token;

  const [transactions, setTransactions] = useState<CreditTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [filter, setFilter] = useState<FilterMode>("all");
  const [hasMore, setHasMore] = useState(true);

  const loadTransactions = useCallback(async (limit: number) => {
    const token = accessTokenRef.current;
    if (!token) return;
    try {
      const result = await fetchCreditTransactions(token, limit);
      setTransactions(result.transactions as unknown as CreditTransaction[]);
      setHasMore(result.transactions.length >= limit);
    } catch {
      // Silently fail — user will see empty state
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTransactions(PAGE_SIZE);
  }, [loadTransactions]);

  const handleLoadMore = async () => {
    setLoadingMore(true);
    const nextLimit = transactions.length + PAGE_SIZE;
    await loadTransactions(nextLimit);
    setLoadingMore(false);
  };

  // Filter transactions
  const filtered = transactions.filter((t) => {
    if (filter === "deducted") return DEDUCT_TYPES.has(t.transaction_type);
    if (filter === "granted") return GRANT_TYPES.has(t.transaction_type);
    return true;
  });

  if (loading) {
    return <LoadingState variant="text" lines={4} className="py-8" />;
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-medium">Usage</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          View your credit usage history and transactions.
        </p>
      </div>

      {/* Filter tabs */}
      <div className="inline-flex gap-1 rounded-full glass-soft border border-border/40 p-1">
        {FILTER_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => setFilter(opt.value)}
            className={`rounded-full px-3 py-1.5 text-xs transition-all duration-200 ${
              filter === opt.value
                ? "bg-foreground text-background font-medium shadow-inner"
                : "text-muted-foreground/70 hover:text-foreground hover:bg-foreground/5"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-12 text-center">
          <Zap className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            No transactions found.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-secondary text-left text-xs font-medium text-muted-foreground">
                <th className="px-4 py-2.5">Description</th>
                <th className="px-4 py-2.5">Type</th>
                <th className="px-4 py-2.5">Date</th>
                <th className="px-4 py-2.5 text-right">Credits</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((t, idx) => {
                const isGrant = !DEDUCT_TYPES.has(t.transaction_type);
                return (
                  <tr
                    key={t.id}
                    className={`border-b last:border-b-0 transition-all duration-300 hover:bg-secondary ${
                      idx % 2 === 1 ? "bg-secondary/50" : ""
                    }`}
                  >
                    <td className="px-4 py-2.5 text-foreground">
                      {t.description ?? TYPE_LABELS[t.transaction_type] ?? t.transaction_type}
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">
                      {TYPE_LABELS[t.transaction_type] ?? t.transaction_type}
                    </td>
                    <td className="px-4 py-2.5 tabular-nums text-muted-foreground">
                      {formatDate(t.created_at)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      <span
                        className={
                          isGrant
                            ? "font-medium text-foreground"
                            : "font-medium text-destructive"
                        }
                      >
                        {isGrant ? "+" : ""}
                        {t.amount}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Load more */}
      {hasMore && filtered.length > 0 && (
        <div className="flex justify-center pt-2">
          <button
            type="button"
            onClick={handleLoadMore}
            disabled={loadingMore}
            className="flex items-center gap-2 rounded-lg border px-4 py-2 text-sm text-muted-foreground transition-all duration-300 hover:bg-secondary disabled:opacity-50"
          >
            {loadingMore && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {loadingMore ? "Loading..." : "Load More"}
          </button>
        </div>
      )}
    </div>
  );
}
