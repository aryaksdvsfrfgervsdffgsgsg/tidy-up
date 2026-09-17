-- Razorpay payment tracking for the "winner pays after auction ends" flow.
-- Scope: only auctions where the winning amount converts to Rs 10,00,000 or
-- less go through this table at all — that cap is enforced in the
-- create-razorpay-order edge function, not here, since it depends on a live
-- FX rate the database can't fetch itself.
--
-- Security model: authenticated users can only ever SELECT their own rows.
-- There is deliberately no INSERT/UPDATE/DELETE policy for `authenticated` —
-- only the service_role key (used exclusively inside the edge functions,
-- never shipped to the browser) can write here. A client cannot mark its own
-- payment "paid"; only a Razorpay-signature-verified server call can.
--
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS public.auction_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auction_id uuid NOT NULL REFERENCES public.auctions(id) ON DELETE CASCADE,
  payer_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount_inr numeric(14,2) NOT NULL,
  razorpay_order_id text NOT NULL,
  razorpay_payment_id text,
  razorpay_signature text,
  status text NOT NULL DEFAULT 'created',
  failure_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  paid_at timestamptz
);

DO $$ BEGIN
  ALTER TABLE public.auction_payments
    ADD CONSTRAINT auction_payments_amount_check CHECK (amount_inr > 0 AND amount_inr <= 1000000);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.auction_payments
    ADD CONSTRAINT auction_payments_status_check CHECK (status IN ('created', 'paid', 'failed'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.auction_payments
    ADD CONSTRAINT auction_payments_order_id_key UNIQUE (razorpay_order_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- One active order per auction — re-creating an order (e.g. retry after a
-- failed attempt) should reuse/replace it, not pile up duplicates.
CREATE UNIQUE INDEX IF NOT EXISTS auction_payments_one_active_per_auction
  ON public.auction_payments (auction_id)
  WHERE status IN ('created', 'paid');

GRANT SELECT ON public.auction_payments TO authenticated;
GRANT ALL ON public.auction_payments TO service_role;
ALTER TABLE public.auction_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Payer and owner can view payment" ON public.auction_payments;
CREATE POLICY "Payer and owner can view payment" ON public.auction_payments
FOR SELECT TO authenticated USING (
  auth.uid() = payer_id OR public.is_auction_owner(auction_payments.auction_id, auth.uid())
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'auction_payments'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.auction_payments;
    END IF;
  END IF;
END $$;
ALTER TABLE public.auction_payments REPLICA IDENTITY FULL;

NOTIFY pgrst, 'reload schema';
