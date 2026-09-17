# What was broken, and what changed

## The one thing you have to do

Open the Lovable Cloud / Supabase **SQL editor** for this project, paste in all of
`apply_this_migration.sql`, and run it. Then hard-refresh the app
(Ctrl/Cmd + Shift + R). Every 400 and 404 in your console comes from the database,
not the frontend.

## Root cause

Your database is still at migration `0002`. Migrations `0003` and `0004` were never
applied, because they were missing from `drizzle/migrations/meta/_journal.json` —
the migration runner only applies what's listed there, and those two entries
weren't. So the app's code asks for columns and tables the database doesn't have:

| Console error | Actual cause |
| --- | --- |
| `400` on `auctions?...visibility=eq.public&status=neq.draft` | column `visibility` doesn't exist |
| `400` on `POST /rest/v1/auctions` | insert names `visibility`, `item_count`, `listing_currency`, `starts_at` |
| `400` on `auctions?...owner_id=eq...&visibility=eq.private` | same missing column |
| `404` on `auction_participants?select=*,auctions(*)` | that table doesn't exist |
| `ERR_NAME_NOT_RESOLVED` | transient DNS failure reaching the backend host — not a code bug. If it persists, the Cloud backend is asleep or the project URL in `.env` is stale. |
| `422` on `/auth/v1/signup` | Supabase rejected the signup: address already registered, password under 6 chars, or a rejected test domain. Now reported in plain words instead of silently failing. |

## Bugs fixed inside the migration itself

The previous `apply_this_migration.sql` would have left you with a broken app even
after running cleanly:

1. **Infinite RLS recursion.** The `auctions` policy queried `auction_participants`,
   whose policy queried `auctions`. Postgres raises
   `infinite recursion detected in policy for relation "auctions"` on *every* read.
   Both directions now go through `SECURITY DEFINER` helpers
   (`is_auction_owner`, `is_auction_participant`, `has_joined_auction`).
2. **Ambiguous column.** `WHERE p.auction_id = id` bound `id` to
   `auction_participants.id` (innermost scope wins), not `auctions.id`, so no
   participant could ever see a private auction. Now fully qualified.
3. **Invites were invisible.** Viewing required `status = 'joined'`, but you can't
   join an auction you can't see — so "Invites you've received" was always empty.
   Viewing now needs only an invite; bidding still requires joining.
4. **Unguarded `ALTER PUBLICATION`** could abort the whole run.
5. **`GET DIAGNOSTICS v_changed = ROW_COUNT`** wrote an integer into a boolean.
   Now an integer with a comparison.
6. **Ambiguous `place_bid`.** Every older signature is dropped before the
   4-argument version is created.
7. Added value repair (`UPDATE ... WHERE ... NOT IN (...)`) before each CHECK
   constraint, so pre-existing rows can't make the migration fail.
8. Added a verification block at the end that raises an error if anything is
   still missing, instead of appearing to succeed.

## Frontend changes

- `src/lib/auction-api.ts` — detects schema drift (`42703`, `42P01`, `PGRST200/202/204/205`),
  reports it in plain language, and degrades instead of throwing: the homepage
  falls back to a query without the new columns, participant/invite lookups
  return empty lists, and missing columns get sane defaults.
- `src/routes/index.tsx` — shows the real reason a load failed.
- `src/routes/private.tsx` — uses the resilient helpers; shows a "Database setup
  incomplete" banner instead of two silently empty sections.
- `src/routes/manage.tsx` — create-auction failures report the actual cause.
- `src/routes/auth.tsx` — maps Supabase's 422 codes (`user_already_exists`,
  `weak_password`, `email_address_invalid`, `signup_disabled`, rate limits) to
  readable messages, normalises the email, enforces the 6-character minimum, and
  detects the "already registered" response that Supabase returns as a 200.
- `drizzle/migrations/0003_feature_expansion.sql` / `0004_leader_name.sql` —
  replaced with the repaired, idempotent versions.
- `drizzle/migrations/meta/_journal.json` — now lists `0003` and `0004`, so the
  runner will apply them on the next deploy.

## After running the migration

The SQL ends with a `SELECT` listing the new columns. If you see
`visibility`, `item_count`, `locked`, `starts_at`, `listing_currency` and
`leader_name`, you're done. If PostgREST still 400s for a minute, it's caching the
old schema — the script sends a reload notification, but restarting the backend
from the Lovable dashboard clears it immediately.
