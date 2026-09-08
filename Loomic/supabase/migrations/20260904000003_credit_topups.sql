-- Helstera credit top-ups (充值流水)
-- Replaces subscription-based billing with pay-as-you-go credits.
-- Each row represents a completed topup purchase from YeePay or Lemon Squeezy.

CREATE TABLE IF NOT EXISTS public.credit_topups (
  -- Primary key: merchant order number (unique across providers)
  out_trade_no text PRIMARY KEY,
  -- YeePay trade number (set after YeePay API call)
  trade_no text,
  -- Workspace that initiated the topup
  workspace_id text NOT NULL,
  -- Topup package id (matches TOPUP_PACKAGES.id from @helstera/shared)
  package_id text NOT NULL,
  -- Amount paid in CNY fen
  amount_cny_fen bigint NOT NULL,
  -- Amount paid in USD cents (for international)
  amount_usd_cents bigint NOT NULL,
  -- Total credits granted (base + bonus)
  credits_granted bigint NOT NULL,
  -- 'pending' | 'paid' | 'failed' | 'refunded'
  status text NOT NULL DEFAULT 'pending',
  -- Payment provider: 'yeepay' | 'lemonsqueezy' | 'manual'
  provider text NOT NULL,
  -- Created/expired/paid timestamps (ms since epoch)
  expired_at bigint NOT NULL,
  created_at bigint NOT NULL,
  paid_at bigint,

  CONSTRAINT credit_topups_status_check
    CHECK (status IN ('pending', 'paid', 'failed', 'refunded', 'expired')),
  CONSTRAINT credit_topups_provider_check
    CHECK (provider IN ('yeepay', 'lemonsqueezy', 'manual'))
);

-- Workspace lookup
CREATE INDEX IF NOT EXISTS credit_topups_workspace_idx
  ON public.credit_topups (workspace_id, created_at DESC);

-- Reconciliation by YeePay trade number
CREATE INDEX IF NOT EXISTS credit_topups_trade_no_idx
  ON public.credit_topups (trade_no)
  WHERE trade_no IS NOT NULL;

-- Status filter for admin views
CREATE INDEX IF NOT EXISTS credit_topups_status_idx
  ON public.credit_topups (status, created_at DESC);

-- ── Atomic credit-add RPC ───────────────────────────────────
-- Replaces old grant_plan_credits — works with the new top-up system.
-- Atomically increments credit_balances + records credit_transactions.

CREATE OR REPLACE FUNCTION public.add_credits(
  p_workspace_id text,
  p_amount bigint,
  p_description text,
  p_type text
)
RETURNS TABLE(new_balance bigint) AS $$
DECLARE
  v_current_balance bigint;
BEGIN
  -- Ensure balance row exists
  INSERT INTO public.credit_balances (workspace_id, balance, updated_at)
    VALUES (p_workspace_id, 0, now())
    ON CONFLICT (workspace_id) DO NOTHING;

  -- Lock the balance row to prevent race conditions
  SELECT balance INTO v_current_balance
    FROM public.credit_balances
    WHERE workspace_id = p_workspace_id
    FOR UPDATE;

  -- Add the credits
  UPDATE public.credit_balances
    SET balance = v_current_balance + p_amount, updated_at = now()
    WHERE workspace_id = p_workspace_id
    RETURNING balance INTO v_current_balance;

  -- Record the transaction
  INSERT INTO public.credit_transactions (
    workspace_id, amount, balance_after, transaction_type, description, created_at
  ) VALUES (
    p_workspace_id, p_amount, v_current_balance, p_type, p_description, now()
  );

  RETURN QUERY SELECT v_current_balance;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
