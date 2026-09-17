-- 0004 (repaired) — leader_name is now created and backfilled by 0003, and the
-- final place_bid (which keeps it in sync) ships there too. This migration is
-- kept as an idempotent safety net for databases where 0003 applied partially.

ALTER TABLE public.auctions ADD COLUMN IF NOT EXISTS leader_name text;

UPDATE public.auctions a
SET leader_name = b.bidder_name
FROM public.bids b
WHERE b.auction_id = a.id
  AND b.seq = a.last_seq
  AND a.leader_id IS NOT NULL
  AND a.leader_name IS DISTINCT FROM b.bidder_name;

NOTIFY pgrst, 'reload schema';
