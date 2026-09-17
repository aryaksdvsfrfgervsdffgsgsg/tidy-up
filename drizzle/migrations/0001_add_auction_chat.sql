CREATE TABLE public.auction_messages (
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
CREATE POLICY "Auction messages are public" ON public.auction_messages FOR SELECT USING (true);
CREATE POLICY "Signed in users can post auction messages" ON public.auction_messages FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE INDEX auction_messages_auction_created_idx ON public.auction_messages (auction_id, created_at DESC);
ALTER TABLE public.auction_messages REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.auction_messages;