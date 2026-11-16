// @credits-system — React hook for credit balance + top-up flows
"use client";

import { useAuth } from "@/lib/auth-context";
import { type CreditBalance, fetchCredits } from "@/lib/credits-api";
import { useCallback, useEffect, useRef, useState } from "react";

export function useCredits() {
  const { session } = useAuth();
  const token = session?.access_token;
  const identity = token
    ? `${session?.user?.id ?? "unknown"}:${token}`
    : undefined;
  const currentToken = useRef(token);
  currentToken.current = token;
  const currentIdentity = useRef(identity);
  currentIdentity.current = identity;
  const latestRequest = useRef(0);

  const [snapshot, setSnapshot] = useState<{
    identity: string | undefined;
    balance: CreditBalance | null;
    loading: boolean;
    error: string | null;
  }>({ identity, balance: null, loading: Boolean(token), error: null });

  const refresh = useCallback(async () => {
    const ownerToken = currentToken.current;
    const owner = currentIdentity.current;
    const request = ++latestRequest.current;
    if (!ownerToken) {
      setSnapshot({
        identity: owner,
        balance: null,
        loading: false,
        error: null,
      });
      return;
    }
    setSnapshot((previous) => ({
      identity: owner,
      balance: previous.identity === owner ? previous.balance : null,
      loading: previous.identity !== owner || previous.balance === null,
      error: null,
    }));
    try {
      const balance = await fetchCredits(ownerToken);
      if (
        latestRequest.current !== request ||
        currentIdentity.current !== owner
      )
        return;
      setSnapshot({ identity: owner, balance, loading: false, error: null });
    } catch (err) {
      if (
        latestRequest.current !== request ||
        currentIdentity.current !== owner
      )
        return;
      setSnapshot((previous) => ({
        identity: owner,
        balance: previous.identity === owner ? previous.balance : null,
        loading: false,
        error: err instanceof Error ? err.message : "Failed to fetch credits",
      }));
    }
  }, []);

  useEffect(() => {
    if (identity) void refresh();
    else setSnapshot({ identity, balance: null, loading: false, error: null });
    return () => {
      latestRequest.current += 1;
    };
  }, [identity, refresh]);

  useEffect(() => {
    const handler = () => {
      if (document.visibilityState === "visible") {
        void refresh();
      }
    };
    document.addEventListener("visibilitychange", handler);
    return () => document.removeEventListener("visibilitychange", handler);
  }, [refresh]);

  // A new identity must never render the prior account's balance before its effect runs.
  const owned = snapshot.identity === identity;
  const data = owned ? snapshot.balance : null;
  return {
    balance: data?.balance ?? 0,
    totalToppedUp: data?.totalToppedUp ?? 0,
    totalSpent: data?.totalSpent ?? 0,
    loading: owned ? snapshot.loading : Boolean(token),
    error: owned ? snapshot.error : null,
    refresh,
  };
}
