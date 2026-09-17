-- Profiles
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT SELECT ON public.profiles TO anon;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Profiles are viewable by everyone" ON public.profiles FOR SELECT USING (true);
CREATE POLICY "Users can insert own profile" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id);

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name)
  VALUES (NEW.id, COALESCE(NULLIF(NEW.raw_user_meta_data ->> 'display_name', ''), split_part(NEW.email, '@', 1)))
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Auctions
CREATE TABLE public.auctions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  starting_price numeric(12,2) NOT NULL DEFAULT 0,
  min_increment numeric(12,2) NOT NULL DEFAULT 1,
  current_price numeric(12,2) NOT NULL DEFAULT 0,
  leader_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  last_seq bigint NOT NULL DEFAULT 0,
  bid_count integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'live',
  ends_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT auctions_status_check CHECK (status IN ('draft','live','ended')),
  CONSTRAINT auctions_increment_check CHECK (min_increment > 0)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.auctions TO authenticated;
GRANT SELECT ON public.auctions TO anon;
GRANT ALL ON public.auctions TO service_role;
ALTER TABLE public.auctions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Live auctions are public" ON public.auctions FOR SELECT USING (status <> 'draft');
CREATE POLICY "Owners can view own auctions" ON public.auctions FOR SELECT TO authenticated USING (auth.uid() = owner_id);
CREATE POLICY "Owners can create auctions" ON public.auctions FOR INSERT TO authenticated WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "Owners can update own auctions" ON public.auctions FOR UPDATE TO authenticated USING (auth.uid() = owner_id);
CREATE POLICY "Owners can delete own auctions" ON public.auctions FOR DELETE TO authenticated USING (auth.uid() = owner_id);

-- Bids
CREATE TABLE public.bids (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auction_id uuid NOT NULL REFERENCES public.auctions(id) ON DELETE CASCADE,
  bidder_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  bidder_name text NOT NULL DEFAULT '',
  amount numeric(12,2) NOT NULL,
  seq bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (auction_id, seq)
);
CREATE INDEX bids_auction_seq_idx ON public.bids (auction_id, seq DESC);
GRANT SELECT ON public.bids TO authenticated;
GRANT SELECT ON public.bids TO anon;
GRANT ALL ON public.bids TO service_role;
ALTER TABLE public.bids ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Bids are public" ON public.bids FOR SELECT USING (true);

-- Atomic serialized bid placement
CREATE OR REPLACE FUNCTION public.place_bid(p_auction_id uuid, p_amount numeric)
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

  IF v_auction.status <> 'live' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'auction_not_live');
  END IF;

  IF v_auction.ends_at IS NOT NULL AND v_auction.ends_at <= now() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'auction_ended');
  END IF;

  v_min := CASE WHEN v_auction.bid_count = 0
                THEN v_auction.starting_price
                ELSE v_auction.current_price + v_auction.min_increment END;

  IF p_amount < v_min THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'too_low', 'min_required', v_min, 'current_price', v_auction.current_price);
  END IF;

  SELECT display_name INTO v_name FROM public.profiles WHERE id = v_user;
  v_seq := v_auction.last_seq + 1;

  INSERT INTO public.bids (auction_id, bidder_id, bidder_name, amount, seq)
  VALUES (p_auction_id, v_user, COALESCE(v_name, 'bidder'), p_amount, v_seq);

  UPDATE public.auctions
     SET current_price = p_amount,
         leader_id = v_user,
         last_seq = v_seq,
         bid_count = bid_count + 1
   WHERE id = p_auction_id;

  RETURN jsonb_build_object('ok', true, 'seq', v_seq, 'amount', p_amount, 'min_required', p_amount + v_auction.min_increment);
END;
$$;

REVOKE ALL ON FUNCTION public.place_bid(uuid, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.place_bid(uuid, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.place_bid(uuid, numeric) TO service_role;

-- Invariant check: gapless, unique, strictly increasing sequence
CREATE OR REPLACE FUNCTION public.check_auction_invariant(p_auction_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total bigint;
  v_distinct bigint;
  v_min bigint;
  v_max bigint;
  v_non_increasing bigint;
  v_violations text[] := '{}';
BEGIN
  SELECT count(*), count(DISTINCT seq), COALESCE(min(seq),0), COALESCE(max(seq),0)
    INTO v_total, v_distinct, v_min, v_max
    FROM public.bids WHERE auction_id = p_auction_id;

  SELECT count(*) INTO v_non_increasing FROM (
    SELECT amount, lag(amount) OVER (ORDER BY seq) AS prev
      FROM public.bids WHERE auction_id = p_auction_id
  ) t WHERE prev IS NOT NULL AND amount <= prev;

  IF v_total > 0 THEN
    IF v_distinct <> v_total THEN
      v_violations := v_violations || format('duplicate sequence numbers: %s rows, %s distinct', v_total, v_distinct);
    END IF;
    IF v_min <> 1 OR v_max <> v_total THEN
      v_violations := v_violations || format('sequence not gapless: min %s, max %s, count %s', v_min, v_max, v_total);
    END IF;
    IF v_non_increasing > 0 THEN
      v_violations := v_violations || format('%s bids did not strictly increase the price', v_non_increasing);
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'ok', array_length(v_violations, 1) IS NULL,
    'accepted', v_total,
    'max_seq', v_max,
    'violations', to_jsonb(v_violations)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_auction_invariant(uuid) TO anon, authenticated, service_role;

-- Realtime
ALTER TABLE public.bids REPLICA IDENTITY FULL;
ALTER TABLE public.auctions REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.bids;
ALTER PUBLICATION supabase_realtime ADD TABLE public.auctions;