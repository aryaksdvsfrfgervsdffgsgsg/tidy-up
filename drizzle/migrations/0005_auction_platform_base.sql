-- Profiles
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT SELECT ON public.profiles TO anon;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Profiles are viewable by everyone" ON public.profiles;
CREATE POLICY "Profiles are viewable by everyone" ON public.profiles FOR SELECT USING (true);
DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
CREATE POLICY "Users can insert own profile" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
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

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Auctions
CREATE TABLE IF NOT EXISTS public.auctions (
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
  CONSTRAINT auctions_increment_check CHECK (min_increment > 0)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.auctions TO authenticated;
GRANT SELECT ON public.auctions TO anon;
GRANT ALL ON public.auctions TO service_role;
ALTER TABLE public.auctions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Owners can view own auctions" ON public.auctions;
CREATE POLICY "Owners can view own auctions" ON public.auctions FOR SELECT TO authenticated USING (auth.uid() = owner_id);
DROP POLICY IF EXISTS "Owners can create auctions" ON public.auctions;
CREATE POLICY "Owners can create auctions" ON public.auctions FOR INSERT TO authenticated WITH CHECK (auth.uid() = owner_id);
DROP POLICY IF EXISTS "Owners can update own auctions" ON public.auctions;
CREATE POLICY "Owners can update own auctions" ON public.auctions FOR UPDATE TO authenticated USING (auth.uid() = owner_id);
DROP POLICY IF EXISTS "Owners can delete own auctions" ON public.auctions;
CREATE POLICY "Owners can delete own auctions" ON public.auctions FOR DELETE TO authenticated USING (auth.uid() = owner_id);

-- Bids
CREATE TABLE IF NOT EXISTS public.bids (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auction_id uuid NOT NULL REFERENCES public.auctions(id) ON DELETE CASCADE,
  bidder_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  bidder_name text NOT NULL DEFAULT '',
  amount numeric(12,2) NOT NULL,
  seq bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (auction_id, seq)
);
CREATE INDEX IF NOT EXISTS bids_auction_seq_idx ON public.bids (auction_id, seq DESC);
GRANT SELECT ON public.bids TO authenticated;
GRANT SELECT ON public.bids TO anon;
GRANT ALL ON public.bids TO service_role;
ALTER TABLE public.bids ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Bids are public" ON public.bids;
CREATE POLICY "Bids are public" ON public.bids FOR SELECT USING (true);

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

ALTER TABLE public.bids REPLICA IDENTITY FULL;
ALTER TABLE public.auctions REPLICA IDENTITY FULL;