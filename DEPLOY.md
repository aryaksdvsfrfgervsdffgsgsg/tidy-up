# Deploying to Vercel

Everything in this folder is the fixed project, ready to push. Nothing about the
build setup was changed, so it deploys exactly the way your current
`auction-updatedx.vercel.app` build does.

## Step 1 — run the SQL first (do not skip)

**Deploying does not fix the 400 and 404 errors.** They come from the database,
not the build. Before or right after deploying, open the Lovable Cloud / Supabase
SQL editor for this project, paste in all of `apply_this_migration.sql`, and run it.

It ends by listing the new columns. If you see `visibility`, `item_count`,
`locked`, `starts_at`, `listing_currency` and `leader_name`, the database is ready.

## Step 2 — push the code

If your Vercel project is already linked to a Git repo:

```bash
# from inside this folder
git add -A
git commit -m "Fix private-auction migration, RLS recursion, and schema-drift handling"
git push
```

Vercel builds on push. Or, with the Vercel CLI from this folder:

```bash
npm i -g vercel
vercel --prod
```

## Step 3 — environment variables

Vercel does not read the committed `.env`. In **Project → Settings → Environment
Variables**, make sure all six exist for Production (and Preview, if you use it):

| Name | Value |
| --- | --- |
| `VITE_SUPABASE_URL` | `https://c--86cec941-9842-4406-bf79-1555e1a54225-prod.lovable.cloud` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_a2wuamBbjw4jw-JPAWP7jQ_Xv6qe-EU` |
| `VITE_SUPABASE_PROJECT_ID` | `nksldioefrdmwrmqexlu` |
| `SUPABASE_URL` | same as `VITE_SUPABASE_URL` |
| `SUPABASE_PUBLISHABLE_KEY` | same as `VITE_SUPABASE_PUBLISHABLE_KEY` |
| `SUPABASE_PROJECT_ID` | same as `VITE_SUPABASE_PROJECT_ID` |

The `VITE_` pair is inlined into the browser bundle at build time; the plain pair
is what the SSR server reads. Both are needed. Changing them requires a redeploy —
Vite bakes them in at build time, so editing a variable alone won't take effect.

## Step 4 — point Supabase auth at the deployed URL

In the Auth settings for the backend, set **Site URL** to
`https://auction-updatedx.vercel.app` and add it (plus
`https://auction-updatedx.vercel.app/**`) to the allowed redirect URLs. Otherwise
the confirmation and password-reset links land back on localhost.

## If the build fails or serves a blank page

This project builds through Nitro, and the Lovable config defaults its target to
Cloudflare. If Vercel produces a build it can't serve, add one more environment
variable and redeploy:

```
NITRO_PRESET = vercel
```

Nitro normally auto-detects Vercel, so only do this if you actually hit the problem.

## Notes

- `bun.lock` is committed, so Vercel will use Bun if it detects it. Build command
  `vite build`, install command left at the default — don't override them.
- `ERR_NAME_NOT_RESOLVED` in your old console log was transient DNS to the backend
  host, unrelated to Vercel. If it keeps happening, the Lovable Cloud backend has
  gone to sleep or the project URL has changed.
