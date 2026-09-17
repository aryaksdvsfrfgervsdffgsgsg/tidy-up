CREATE TYPE public.app_role AS ENUM ('admin', 'moderator', 'user');

CREATE TABLE public.user_roles (
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

CREATE POLICY "Users can view own roles" ON public.user_roles
FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Admins can view roles" ON public.user_roles
FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE TABLE public.auction_events (
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
CREATE POLICY "Owners can view auction history" ON public.auction_events
FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.auctions a WHERE a.id = auction_id AND a.owner_id = auth.uid())
);
CREATE POLICY "Admins can view auction history" ON public.auction_events
FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE INDEX auction_events_auction_created_idx ON public.auction_events (auction_id, created_at DESC);

CREATE TABLE public.notifications (
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
CREATE POLICY "Users can view own notifications" ON public.notifications
FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can mark own notifications read" ON public.notifications
FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX notifications_user_created_idx ON public.notifications (user_id, created_at DESC);
CREATE UNIQUE INDEX notifications_unread_event_idx ON public.notifications (user_id, auction_id, notification_type) WHERE read_at IS NULL;
ALTER TABLE public.notifications REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;

CREATE TABLE public.notification_preferences (
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
CREATE POLICY "Users manage own notification preferences" ON public.notification_preferences
FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.record_auction_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_type text;
  v_summary text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.auction_events (auction_id, actor_id, event_type, summary, details)
    VALUES (NEW.id, NEW.owner_id, 'created', 'Auction created', jsonb_build_object('starting_price', NEW.starting_price, 'min_increment', NEW.min_increment, 'ends_at', NEW.ends_at));
    RETURN NEW;
  END IF;

  IF OLD.status IS DISTINCT FROM NEW.status THEN
    v_type := CASE WHEN NEW.status = 'ended' THEN 'closed' ELSE 'status_changed' END;
    v_summary := CASE WHEN NEW.status = 'ended' THEN 'Auction closed' ELSE 'Status changed to ' || NEW.status END;
    INSERT INTO public.auction_events (auction_id, actor_id, event_type, summary, details)
    VALUES (NEW.id, auth.uid(), v_type, v_summary, jsonb_build_object('from', OLD.status, 'to', NEW.status));

    IF NEW.status = 'ended' THEN
      INSERT INTO public.notifications (user_id, auction_id, notification_type, title, body, payload)
      SELECT recipient, NEW.id, 'auction_closed', 'Auction closed: ' || NEW.title,
             CASE WHEN recipient = NEW.leader_id THEN 'You won at ' || NEW.current_price::text || '.' ELSE 'Final price: ' || NEW.current_price::text || '.' END,
             jsonb_build_object('amount', NEW.current_price, 'winner', recipient = NEW.leader_id)
      FROM (
        SELECT NEW.owner_id AS recipient
        UNION SELECT bidder_id FROM public.bids WHERE auction_id = NEW.id
      ) recipients
      WHERE recipient IS NOT NULL
        AND COALESCE((SELECT in_app_auction_closed FROM public.notification_preferences WHERE user_id = recipient), true)
      ON CONFLICT (user_id, auction_id, notification_type) WHERE read_at IS NULL
      DO UPDATE SET title = EXCLUDED.title, body = EXCLUDED.body, payload = EXCLUDED.payload, created_at = now();
    END IF;
  END IF;

  IF OLD.starting_price IS DISTINCT FROM NEW.starting_price
     OR OLD.min_increment IS DISTINCT FROM NEW.min_increment
     OR OLD.ends_at IS DISTINCT FROM NEW.ends_at THEN
    INSERT INTO public.auction_events (auction_id, actor_id, event_type, summary, details)
    VALUES (NEW.id, auth.uid(), 'settings_edited', 'Auction settings updated',
      jsonb_build_object(
        'starting_price', jsonb_build_object('from', OLD.starting_price, 'to', NEW.starting_price),
        'min_increment', jsonb_build_object('from', OLD.min_increment, 'to', NEW.min_increment),
        'ends_at', jsonb_build_object('from', OLD.ends_at, 'to', NEW.ends_at)
      ));
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER auction_change_history
AFTER INSERT OR UPDATE ON public.auctions
FOR EACH ROW EXECUTE FUNCTION public.record_auction_change();

CREATE OR REPLACE FUNCTION public.record_bid_and_notify()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_auction public.auctions%ROWTYPE;
BEGIN
  SELECT * INTO v_auction FROM public.auctions WHERE id = NEW.auction_id;
  INSERT INTO public.auction_events (auction_id, actor_id, event_type, summary, details)
  VALUES (NEW.auction_id, NEW.bidder_id, 'bid_placed', NEW.bidder_name || ' bid ' || NEW.amount::text,
    jsonb_build_object('seq', NEW.seq, 'amount', NEW.amount, 'bidder_name', NEW.bidder_name));

  INSERT INTO public.notifications (user_id, auction_id, notification_type, title, body, payload)
  SELECT recipient, NEW.auction_id, 'new_bid', 'New bid on ' || v_auction.title,
         NEW.bidder_name || ' bid ' || NEW.amount::text || ' at position #' || NEW.seq::text || '.',
         jsonb_build_object('amount', NEW.amount, 'seq', NEW.seq, 'bidder_name', NEW.bidder_name)
  FROM (
    SELECT v_auction.owner_id AS recipient
    UNION SELECT bidder_id FROM public.bids WHERE auction_id = NEW.auction_id
  ) recipients
  WHERE recipient IS NOT NULL
    AND recipient <> NEW.bidder_id
    AND COALESCE((SELECT in_app_new_bids FROM public.notification_preferences WHERE user_id = recipient), true)
  ON CONFLICT (user_id, auction_id, notification_type) WHERE read_at IS NULL
  DO UPDATE SET title = EXCLUDED.title, body = EXCLUDED.body, payload = EXCLUDED.payload, created_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER bid_history_and_notifications
AFTER INSERT ON public.bids
FOR EACH ROW EXECUTE FUNCTION public.record_bid_and_notify();

CREATE OR REPLACE FUNCTION public.sync_auction_close(p_auction_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_changed boolean := false;
BEGIN
  UPDATE public.auctions
  SET status = 'ended'
  WHERE id = p_auction_id AND status = 'live' AND ends_at IS NOT NULL AND ends_at <= now();
  GET DIAGNOSTICS v_changed = ROW_COUNT;
  RETURN v_changed;
END;
$$;
GRANT EXECUTE ON FUNCTION public.sync_auction_close(uuid) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.set_admin_role(p_user_id uuid, p_enabled boolean)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  IF p_enabled THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (p_user_id, 'admin') ON CONFLICT DO NOTHING;
  ELSE
    IF p_user_id = auth.uid() THEN RAISE EXCEPTION 'You cannot remove your own admin access'; END IF;
    DELETE FROM public.user_roles WHERE user_id = p_user_id AND role = 'admin';
  END IF;
  RETURN true;
END;
$$;
GRANT EXECUTE ON FUNCTION public.set_admin_role(uuid, boolean) TO authenticated, service_role;

CREATE POLICY "Admins can view every profile" ON public.profiles
FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can view every auction" ON public.auctions
FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can view every bid" ON public.bids
FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
