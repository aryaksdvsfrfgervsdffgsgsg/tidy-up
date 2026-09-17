-- 0003 (repaired) — private auctions, participant caps, item count, locking,
-- scheduling, listing currency, the Rs 10L payment-acknowledgement gate, and
-- the leader_name (winner) column.
--
-- Repaired vs. the original 0003/0004: RLS no longer recurses between auctions
-- and auction_participants (SECURITY DEFINER helpers break the loop), the
-- participant lookup qualifies auctions.id, invited-but-not-joined users can
-- see the auction they were invited to, realtime registration is guarded, and
-- GET DIAGNOSTICS writes into an integer. Fully idempotent.

-- PART 0 — Safety net for 0001 / 0002 objects.
-- These should already exist. Every statement is guarded, so if your database
-- is further behind than expected this brings it up to date instead of failing.
-- ============================================================================

-- 0001: auction chat -------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.auction_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auction_id uuid NOT NULL REFERENCES public.auctions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  sender_name text NOT NULL DEFAULT 'bidder',
  content text NOT NULL CHECK (char_length(content) BETWEEN 1 AND 500),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.auction_messages TO authenticated;
GRANT SELECT ON public.auction_messages TO anon;
GRANT ALL ON public.auction_messages TO service_role;
ALTER TABLE public.auction_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Auction messages are public" ON public.auction_messages;
CREATE POLICY "Auction messages are public" ON public.auction_messages
FOR SELECT USING (true);

DROP POLICY IF EXISTS "Signed in users can post auction messages" ON public.auction_messages;
CREATE POLICY "Signed in users can post auction messages" ON public.auction_messages
FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS auction_messages_auction_created_idx
  ON public.auction_messages (auction_id, created_at DESC);
ALTER TABLE public.auction_messages REPLICA IDENTITY FULL;

-- 0002: roles ---------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE public.app_role AS ENUM ('admin', 'moderator', 'user');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role
  )
$$;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, service_role;

DROP POLICY IF EXISTS "Users can view own roles" ON public.user_roles;
CREATE POLICY "Users can view own roles" ON public.user_roles
FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Admins can view roles" ON public.user_roles;
CREATE POLICY "Admins can view roles" ON public.user_roles
FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- 0002: audit trail ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.auction_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auction_id uuid NOT NULL REFERENCES public.auctions(id) ON DELETE CASCADE,
  actor_id uuid,
  event_type text NOT NULL CHECK (event_type IN ('created', 'bid_placed', 'settings_edited', 'status_changed', 'closed')),
  summary text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.auction_events TO authenticated;
GRANT ALL ON public.auction_events TO service_role;
ALTER TABLE public.auction_events ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS auction_events_auction_created_idx
  ON public.auction_events (auction_id, created_at DESC);

DROP POLICY IF EXISTS "Owners can view auction history" ON public.auction_events;
CREATE POLICY "Owners can view auction history" ON public.auction_events
FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.auctions a WHERE a.id = auction_events.auction_id AND a.owner_id = auth.uid())
);

DROP POLICY IF EXISTS "Admins can view auction history" ON public.auction_events;
CREATE POLICY "Admins can view auction history" ON public.auction_events
FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Admins can view every profile" ON public.profiles;
CREATE POLICY "Admins can view every profile" ON public.profiles
FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Admins can view every auction" ON public.auctions;
CREATE POLICY "Admins can view every auction" ON public.auctions
FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Admins can view every bid" ON public.bids;
CREATE POLICY "Admins can view every bid" ON public.bids
FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- 0002: notifications -------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  auction_id uuid REFERENCES public.auctions(id) ON DELETE CASCADE,
  notification_type text NOT NULL CHECK (notification_type IN ('new_bid', 'auction_closed')),
  title text NOT NULL,
  body text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, UPDATE ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own notifications" ON public.notifications;
CREATE POLICY "Users can view own notifications" ON public.notifications
FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can mark own notifications read" ON public.notifications;
CREATE POLICY "Users can mark own notifications read" ON public.notifications
FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS notifications_user_created_idx
  ON public.notifications (user_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS notifications_unread_event_idx
  ON public.notifications (user_id, auction_id, notification_type) WHERE read_at IS NULL;
ALTER TABLE public.notifications REPLICA IDENTITY FULL;

CREATE TABLE IF NOT EXISTS public.notification_preferences (
  user_id uuid PRIMARY KEY,
  email_new_bids boolean NOT NULL DEFAULT true,
  email_auction_closed boolean NOT NULL DEFAULT true,
  in_app_new_bids boolean NOT NULL DEFAULT true,
  in_app_auction_closed boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.notification_preferences TO authenticated;
GRANT ALL ON public.notification_preferences TO service_role;
ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own notification preferences" ON public.notification_preferences;
CREATE POLICY "Users manage own notification preferences" ON public.notification_preferences
FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);


-- ============================================================================
-- PART 1 — 0003: new auction columns
-- ============================================================================

ALTER TABLE public.auctions
  ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'public',
  ADD COLUMN IF NOT EXISTS participant_limit integer,
  ADD COLUMN IF NOT EXISTS item_count integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS locked boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS starts_at timestamptz,
  ADD COLUMN IF NOT EXISTS listing_currency text NOT NULL DEFAULT 'USD',
  ADD COLUMN IF NOT EXISTS payment_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS payment_confirmed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS leader_name text;

-- Repair any rows that predate the columns / hold values the checks reject,
-- otherwise the constraints below would fail to validate.
UPDATE public.auctions SET visibility = 'public'        WHERE visibility IS NULL OR visibility NOT IN ('public','private');
UPDATE public.auctions SET item_count = 1               WHERE item_count IS NULL OR item_count < 1;
UPDATE public.auctions SET listing_currency = 'USD'     WHERE listing_currency IS NULL OR char_length(listing_currency) <> 3;
UPDATE public.auctions SET participant_limit = NULL     WHERE participant_limit IS NOT NULL AND participant_limit <= 0;
UPDATE public.auctions SET status = 'live'              WHERE status NOT IN ('draft','scheduled','live','ended');

ALTER TABLE public.auctions DROP CONSTRAINT IF EXISTS auctions_visibility_check;
ALTER TABLE public.auctions
  ADD CONSTRAINT auctions_visibility_check CHECK (visibility IN ('public','private'));

ALTER TABLE public.auctions DROP CONSTRAINT IF EXISTS auctions_participant_limit_check;
ALTER TABLE public.auctions
  ADD CONSTRAINT auctions_participant_limit_check CHECK (participant_limit IS NULL OR participant_limit > 0);

ALTER TABLE public.auctions DROP CONSTRAINT IF EXISTS auctions_item_count_check;
ALTER TABLE public.auctions
  ADD CONSTRAINT auctions_item_count_check CHECK (item_count > 0);

ALTER TABLE public.auctions DROP CONSTRAINT IF EXISTS auctions_listing_currency_check;
ALTER TABLE public.auctions
  ADD CONSTRAINT auctions_listing_currency_check CHECK (char_length(listing_currency) = 3);

-- "Upcoming" auctions get a real status instead of overloading draft/live.
ALTER TABLE public.auctions DROP CONSTRAINT IF EXISTS auctions_status_check;
ALTER TABLE public.auctions
  ADD CONSTRAINT auctions_status_check CHECK (status IN ('draft','scheduled','live','ended'));

-- Bids: what the bidder agreed to, plus the INR-equivalent snapshot used to
-- decide whether the acknowledgement was required. This is a policy gate, not
-- a payment integration — no money moves through the database.
ALTER TABLE public.bids
  ADD COLUMN IF NOT EXISTS payment_ack boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS amount_inr numeric(14,2);


-- ============================================================================
-- PART 2 — 0003: private-auction participants
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.auction_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auction_id uuid NOT NULL REFERENCES public.auctions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'invited' CHECK (status IN ('invited', 'joined')),
  invited_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  joined_at timestamptz,
  UNIQUE (auction_id, user_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.auction_participants TO authenticated;
GRANT ALL ON public.auction_participants TO service_role;
ALTER TABLE public.auction_participants ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS auction_participants_auction_idx
  ON public.auction_participants (auction_id, status);
CREATE INDEX IF NOT EXISTS auction_participants_user_idx
  ON public.auction_participants (user_id);
ALTER TABLE public.auction_participants REPLICA IDENTITY FULL;

-- --- Recursion-breaking helpers -------------------------------------------
-- RLS policies that read another RLS-protected table trigger that table's own
-- policies. auctions <-> auction_participants referencing each other therefore
-- produced "infinite recursion detected in policy" on every single read. These
-- SECURITY DEFINER functions bypass RLS for the lookup, which breaks the loop.

CREATE OR REPLACE FUNCTION public.is_auction_owner(p_auction_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.auctions a
    WHERE a.id = p_auction_id AND a.owner_id = p_user_id
  )
$$;
GRANT EXECUTE ON FUNCTION public.is_auction_owner(uuid, uuid) TO authenticated, service_role;

-- Any invite at all is enough to SEE the auction (so the invite card can render
-- its title and price). Actually bidding still requires status = 'joined',
-- which place_bid enforces separately.
CREATE OR REPLACE FUNCTION public.is_auction_participant(p_auction_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.auction_participants p
    WHERE p.auction_id = p_auction_id AND p.user_id = p_user_id
  )
$$;
GRANT EXECUTE ON FUNCTION public.is_auction_participant(uuid, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.has_joined_auction(p_auction_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.auction_participants p
    WHERE p.auction_id = p_auction_id AND p.user_id = p_user_id AND p.status = 'joined'
  )
$$;
GRANT EXECUTE ON FUNCTION public.has_joined_auction(uuid, uuid) TO authenticated, service_role;

-- --- Participant policies (no direct reference to public.auctions) ---------
DROP POLICY IF EXISTS "Owners manage participants" ON public.auction_participants;
CREATE POLICY "Owners manage participants" ON public.auction_participants
FOR ALL TO authenticated
USING (public.is_auction_owner(auction_participants.auction_id, auth.uid()))
WITH CHECK (public.is_auction_owner(auction_participants.auction_id, auth.uid()));

DROP POLICY IF EXISTS "Invitees can view own invite" ON public.auction_participants;
CREATE POLICY "Invitees can view own invite" ON public.auction_participants
FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Invitees can accept own invite" ON public.auction_participants;
CREATE POLICY "Invitees can accept own invite" ON public.auction_participants
FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- --- Auction visibility policies ------------------------------------------
DROP POLICY IF EXISTS "Live auctions are public" ON public.auctions;
DROP POLICY IF EXISTS "Public auctions are visible to everyone" ON public.auctions;
CREATE POLICY "Public auctions are visible to everyone" ON public.auctions
FOR SELECT USING (status <> 'draft' AND visibility = 'public');

-- Note the fully-qualified auctions.id. Writing a bare `id` here would bind to
-- the subquery's own table, silently matching nothing.
DROP POLICY IF EXISTS "Participants can view their private auctions" ON public.auctions;
CREATE POLICY "Participants can view their private auctions" ON public.auctions
FOR SELECT TO authenticated
USING (visibility = 'private' AND public.is_auction_participant(auctions.id, auth.uid()));

-- --- Realtime --------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    RAISE NOTICE 'publication supabase_realtime not found — skipping realtime registration';
    RETURN;
  END IF;

  FOREACH t IN ARRAY ARRAY['auctions','bids','auction_messages','notifications','auction_participants'] LOOP
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = t)
       AND NOT EXISTS (
         SELECT 1 FROM pg_publication_tables
         WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
       )
    THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;


-- ============================================================================
-- PART 3 — 0003: RPC functions
-- ============================================================================

-- Accept an invite (enforces the participant cap atomically).
CREATE OR REPLACE FUNCTION public.join_private_auction(p_auction_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_auction public.auctions%ROWTYPE;
  v_user uuid := auth.uid();
  v_joined_count integer;
BEGIN
  IF v_user IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_signed_in');
  END IF;

  SELECT * INTO v_auction FROM public.auctions WHERE id = p_auction_id FOR UPDATE;
  IF NOT FOUND OR v_auction.visibility <> 'private' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_such_private_auction');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.auction_participants
    WHERE auction_id = p_auction_id AND user_id = v_user
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_invited');
  END IF;

  -- Already joined: succeed quietly so a double-click isn't an error.
  IF EXISTS (
    SELECT 1 FROM public.auction_participants
    WHERE auction_id = p_auction_id AND user_id = v_user AND status = 'joined'
  ) THEN
    RETURN jsonb_build_object('ok', true);
  END IF;

  SELECT count(*) INTO v_joined_count FROM public.auction_participants
    WHERE auction_id = p_auction_id AND status = 'joined';

  IF v_auction.participant_limit IS NOT NULL AND v_joined_count >= v_auction.participant_limit THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'participant_limit_reached');
  END IF;

  UPDATE public.auction_participants SET status = 'joined', joined_at = now()
    WHERE auction_id = p_auction_id AND user_id = v_user;
  RETURN jsonb_build_object('ok', true);
END;
$$;
GRANT EXECUTE ON FUNCTION public.join_private_auction(uuid) TO authenticated;

-- Owner invites a registered user by email to a private auction.
CREATE OR REPLACE FUNCTION public.invite_to_auction(p_auction_id uuid, p_email text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner uuid;
  v_target uuid;
BEGIN
  SELECT owner_id INTO v_owner FROM public.auctions WHERE id = p_auction_id;
  IF v_owner IS NULL OR v_owner <> auth.uid() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_owner');
  END IF;

  SELECT id INTO v_target FROM auth.users WHERE lower(email) = lower(trim(p_email)) LIMIT 1;
  IF v_target IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_such_user');
  END IF;

  IF v_target = v_owner THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'cannot_invite_self');
  END IF;

  INSERT INTO public.auction_participants (auction_id, user_id, invited_by)
  VALUES (p_auction_id, v_target, auth.uid())
  ON CONFLICT (auction_id, user_id) DO NOTHING;

  RETURN jsonb_build_object('ok', true);
END;
$$;
GRANT EXECUTE ON FUNCTION public.invite_to_auction(uuid, text) TO authenticated;

-- A scheduled ("upcoming") auction flips to live once its start time passes.
-- ROW_COUNT is an integer; assigning it straight into a boolean was fragile.
CREATE OR REPLACE FUNCTION public.sync_auction_start(p_auction_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_rows integer := 0;
BEGIN
  UPDATE public.auctions
  SET status = 'live'
  WHERE id = p_auction_id AND status = 'scheduled' AND starts_at IS NOT NULL AND starts_at <= now();
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows > 0;
END;
$$;
GRANT EXECUTE ON FUNCTION public.sync_auction_start(uuid) TO anon, authenticated, service_role;

-- Same fix for the existing close helper from 0002.
CREATE OR REPLACE FUNCTION public.sync_auction_close(p_auction_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_rows integer := 0;
BEGIN
  UPDATE public.auctions
  SET status = 'ended'
  WHERE id = p_auction_id AND status = 'live' AND ends_at IS NOT NULL AND ends_at <= now();
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows > 0;
END;
$$;
GRANT EXECUTE ON FUNCTION public.sync_auction_close(uuid) TO anon, authenticated, service_role;

-- Owner marks the winning bid's payment as received (manual, no gateway).
CREATE OR REPLACE FUNCTION public.confirm_auction_payment(p_auction_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_owner uuid;
BEGIN
  SELECT owner_id INTO v_owner FROM public.auctions WHERE id = p_auction_id;
  IF v_owner IS NULL OR v_owner <> auth.uid() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_owner');
  END IF;
  UPDATE public.auctions
     SET payment_confirmed_at = now(), payment_confirmed_by = auth.uid()
   WHERE id = p_auction_id;
  RETURN jsonb_build_object('ok', true);
END;
$$;
GRANT EXECUTE ON FUNCTION public.confirm_auction_payment(uuid) TO authenticated;


-- ============================================================================
-- PART 4 — place_bid, final version (0003 + 0004 merged)
-- Owner lock, scheduled/private gating, ₹10L payment ack, leader_name.
-- ============================================================================

-- Drop every older signature so the 4-argument call is never ambiguous.
DROP FUNCTION IF EXISTS public.place_bid(uuid, numeric);
DROP FUNCTION IF EXISTS public.place_bid(uuid, numeric, boolean);
DROP FUNCTION IF EXISTS public.place_bid(uuid, numeric, boolean, numeric);

CREATE FUNCTION public.place_bid(
  p_auction_id uuid,
  p_amount numeric,
  p_payment_ack boolean DEFAULT false,
  p_amount_inr numeric DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_auction public.auctions%ROWTYPE;
  v_user uuid := auth.uid();
  v_name text;
  v_min numeric;
  v_seq bigint;
BEGIN
  IF v_user IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_signed_in');
  END IF;

  -- Serialize every bid for this auction: one writer at a time.
  SELECT * INTO v_auction FROM public.auctions WHERE id = p_auction_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_such_auction');
  END IF;

  IF v_auction.locked THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'auction_locked');
  END IF;

  IF v_auction.status NOT IN ('live', 'scheduled') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'auction_not_live');
  END IF;

  IF v_auction.status = 'scheduled' AND v_auction.starts_at IS NOT NULL AND v_auction.starts_at > now() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_started');
  END IF;

  IF v_auction.ends_at IS NOT NULL AND v_auction.ends_at <= now() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'auction_ended');
  END IF;

  -- Private auctions: the owner always may, everyone else must have joined.
  IF v_auction.visibility = 'private' AND v_auction.owner_id <> v_user THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.auction_participants
      WHERE auction_id = p_auction_id AND user_id = v_user AND status = 'joined'
    ) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'not_a_participant');
    END IF;
  END IF;

  v_min := CASE WHEN v_auction.bid_count = 0
                THEN v_auction.starting_price
                ELSE v_auction.current_price + v_auction.min_increment END;

  IF p_amount < v_min THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'too_low', 'min_required', v_min, 'current_price', v_auction.current_price);
  END IF;

  IF p_amount_inr IS NOT NULL AND p_amount_inr >= 1000000 AND NOT p_payment_ack THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'payment_ack_required');
  END IF;

  SELECT display_name INTO v_name FROM public.profiles WHERE id = v_user;
  v_seq := v_auction.last_seq + 1;

  INSERT INTO public.bids (auction_id, bidder_id, bidder_name, amount, seq, payment_ack, amount_inr)
  VALUES (p_auction_id, v_user, COALESCE(v_name, 'bidder'), p_amount, v_seq, p_payment_ack, p_amount_inr);

  UPDATE public.auctions
     SET current_price = p_amount,
         leader_id = v_user,
         leader_name = COALESCE(v_name, 'bidder'),
         last_seq = v_seq,
         bid_count = bid_count + 1
   WHERE id = p_auction_id;

  RETURN jsonb_build_object('ok', true, 'seq', v_seq, 'amount', p_amount, 'min_required', p_amount + v_auction.min_increment);
END;
$$;

REVOKE ALL ON FUNCTION public.place_bid(uuid, numeric, boolean, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.place_bid(uuid, numeric, boolean, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.place_bid(uuid, numeric, boolean, numeric) TO service_role;

-- Backfill leader_name for auctions that already have bids.
UPDATE public.auctions a
SET leader_name = b.bidder_name
FROM public.bids b
WHERE b.auction_id = a.id
  AND b.seq = a.last_seq
  AND a.leader_id IS NOT NULL
  AND a.leader_name IS DISTINCT FROM b.bidder_name;


-- ============================================================================

NOTIFY pgrst, 'reload schema';
