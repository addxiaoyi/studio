-- Helstera YeePay (易支付) orders table
-- Stores pending and completed payment orders for the Chinese market (CNY).
-- YeePay is the China payment provider; Lemon Squeezy handles international.

CREATE TABLE IF NOT EXISTS public.yeepay_orders (
  -- Merchant order number (Helstera-generated, unique)
  out_trade_no text PRIMARY KEY,
  -- YeePay transaction number (set after YeePay API call)
  trade_no text,
  -- Workspace that initiated the order
  workspace_id text NOT NULL,
  -- Subscription plan (starter/pro/ultra/business)
  plan text NOT NULL,
  -- 'monthly' or 'yearly'
  billing_period text NOT NULL,
  -- Total amount in CNY 分 (cents)
  total_amount bigint NOT NULL,
  -- 'pending' | 'paid' | 'failed' | 'refunded'
  status text NOT NULL DEFAULT 'pending',
  -- QR code URL (user scans this to pay via H5 wallet)
  qr_code_url text,
  -- Order expiry timestamp (ms since epoch)
  expired_at bigint NOT NULL,
  -- Created timestamp (ms since epoch)
  created_at bigint NOT NULL,
  -- Paid timestamp (ms since epoch, null until paid)
  paid_at bigint,

  CONSTRAINT yeepay_orders_plan_check
    CHECK (plan IN ('starter', 'pro', 'ultra', 'business')),
  CONSTRAINT yeepay_orders_billing_period_check
    CHECK (billing_period IN ('monthly', 'yearly')),
  CONSTRAINT yeepay_orders_status_check
    CHECK (status IN ('pending', 'paid', 'failed', 'refunded', 'expired'))
);

-- Lookup by workspace for "my recent orders" admin views
CREATE INDEX IF NOT EXISTS yeepay_orders_workspace_idx
  ON public.yeepay_orders (workspace_id, created_at DESC);

-- Lookup by YeePay transaction number (for reconciliation)
CREATE INDEX IF NOT EXISTS yeepay_orders_trade_no_idx
  ON public.yeepay_orders (trade_no)
  WHERE trade_no IS NOT NULL;

-- Audit events (mirror of payment_events for Lemon Squeezy)
CREATE TABLE IF NOT EXISTS public.yeepay_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  out_trade_no text NOT NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  processed boolean NOT NULL DEFAULT false,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS yeepay_events_out_trade_no_idx
  ON public.yeepay_events (out_trade_no);
