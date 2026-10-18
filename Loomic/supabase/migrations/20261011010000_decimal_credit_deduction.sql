-- Video prices are fractional credits (for example 2.25 for a 5-second job).
ALTER TABLE public.credit_balances
  ALTER COLUMN balance TYPE numeric(14,4) USING balance::numeric;

ALTER TABLE public.credit_transactions
  ALTER COLUMN amount TYPE numeric(14,4) USING amount::numeric,
  ALTER COLUMN balance_after TYPE numeric(14,4) USING balance_after::numeric;

ALTER TABLE public.background_jobs
  ALTER COLUMN credits_cost TYPE numeric(14,4) USING credits_cost::numeric;

DROP FUNCTION IF EXISTS public.deduct_credits(uuid, uuid, integer, uuid, text);
CREATE OR REPLACE FUNCTION public.deduct_credits(
  p_workspace_id uuid,
  p_user_id uuid,
  p_amount numeric,
  p_job_id uuid,
  p_description text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_balance numeric;
  v_new_balance numeric;
  v_version integer;
  v_tx_id uuid;
BEGIN
  IF p_job_id IS NOT NULL THEN
    SELECT id INTO v_tx_id
    FROM public.credit_transactions
    WHERE job_id = p_job_id AND transaction_type = 'generation_deduct'
    ORDER BY created_at
    LIMIT 1;
    IF FOUND THEN RETURN v_tx_id; END IF;
  END IF;

  SELECT balance, version INTO v_balance, v_version
  FROM public.credit_balances
  WHERE workspace_id = p_workspace_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NO_BALANCE: No credit balance found for workspace %', p_workspace_id;
  END IF;
  v_new_balance := v_balance - p_amount;
  IF v_new_balance < 0 THEN
    RAISE EXCEPTION 'INSUFFICIENT_CREDITS: have %, need %', v_balance, p_amount;
  END IF;
  UPDATE public.credit_balances
  SET balance = v_new_balance, version = v_version + 1, updated_at = now()
  WHERE workspace_id = p_workspace_id AND version = v_version;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CONCURRENT_MODIFICATION: credit balance was modified concurrently';
  END IF;
  INSERT INTO public.credit_transactions
    (workspace_id, user_id, transaction_type, amount, balance_after, job_id, description)
  VALUES
    (p_workspace_id, p_user_id, 'generation_deduct', -p_amount, v_new_balance, p_job_id, p_description)
  RETURNING id INTO v_tx_id;
  RETURN v_tx_id;
END;
$$;

DROP FUNCTION IF EXISTS public.refund_credits(uuid, uuid, integer, uuid, text);
CREATE OR REPLACE FUNCTION public.refund_credits(
  p_workspace_id uuid,
  p_user_id uuid,
  p_amount numeric,
  p_job_id uuid,
  p_description text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_balance numeric;
  v_version integer;
  v_new_balance numeric;
  v_tx_id uuid;
BEGIN
  IF p_job_id IS NOT NULL THEN
    SELECT id INTO v_tx_id
    FROM public.credit_transactions
    WHERE job_id = p_job_id AND transaction_type = 'generation_refund'
    ORDER BY created_at
    LIMIT 1;
    IF FOUND THEN RETURN v_tx_id; END IF;
  END IF;
  SELECT balance, version INTO v_balance, v_version
  FROM public.credit_balances
  WHERE workspace_id = p_workspace_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NO_BALANCE: No credit balance found for workspace %', p_workspace_id;
  END IF;
  v_new_balance := v_balance + p_amount;
  UPDATE public.credit_balances
  SET balance = v_new_balance, version = v_version + 1, updated_at = now()
  WHERE workspace_id = p_workspace_id AND version = v_version;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CONCURRENT_MODIFICATION: credit balance was modified concurrently';
  END IF;
  INSERT INTO public.credit_transactions
    (workspace_id, user_id, transaction_type, amount, balance_after, job_id, description)
  VALUES
    (p_workspace_id, p_user_id, 'generation_refund', p_amount, v_new_balance, p_job_id, p_description)
  RETURNING id INTO v_tx_id;
  RETURN v_tx_id;
END;
$$;
