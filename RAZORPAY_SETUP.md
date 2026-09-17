# Razorpay setup

What's already built: the code that creates orders, opens checkout, and
verifies payments. What's missing is entirely on Razorpay's and Supabase's
side — your account, your keys, and deploying the three new server functions.
Nothing here works until you do these steps once.

## 1. Create a Razorpay account and get test keys

1. Sign up at https://dashboard.razorpay.com/signup.
2. You don't need to finish KYC/business verification to get **test mode**
   keys — they're available immediately after signup.
3. In the dashboard: **Settings → API Keys → Generate Test Key**. You'll get
   a **Key ID** (starts `rzp_test_...`) and a **Key Secret** — shown only
   once, so save it somewhere safe immediately.

Test mode lets you run the whole flow with Razorpay's documented test card
numbers — no real money moves. Switch to live keys later the same way, once
you've verified everything works and completed Razorpay's KYC.

## 2. Add the two secrets to Supabase (never to this repo)

The Key Secret must never appear in code, an env var prefixed `VITE_`, or
anywhere that ships to the browser — that would let anyone who opens your
site's JS bundle fake a "successful" payment. It only goes here:

```bash
supabase secrets set RAZORPAY_KEY_ID=rzp_test_xxxxxxxxxxxx
supabase secrets set RAZORPAY_KEY_SECRET=your_secret_here
```

If you're managing this through Lovable Cloud's own interface instead of the
CLI, ask Lovable's assistant to set these two secrets for the project — same
two names, same values.

## 3. Deploy the three edge functions

```bash
supabase functions deploy create-razorpay-order
supabase functions deploy verify-razorpay-payment
supabase functions deploy razorpay-webhook --no-verify-jwt
```

The `--no-verify-jwt` on the webhook is required — Razorpay's servers call it
directly and don't send a Supabase login token. Its security comes entirely
from the webhook signature (step 5), not from Supabase auth.

## 4. Run the new migration

`drizzle/migrations/0005_razorpay_payments.sql` adds the `auction_payments`
table this all writes to. Same process as before: paste it into the SQL
editor for this project and run it. It's idempotent, like the others.

## 5. Configure the webhook (recommended, not strictly required to test)

The webhook is what confirms payment even if someone closes their browser
right after paying, before the on-screen confirmation fires. Without it, that
specific edge case would leave a payment stuck as "created" until you check
manually.

1. Razorpay dashboard → **Settings → Webhooks → Add New Webhook**.
2. URL: `https://<your-project-ref>.supabase.co/functions/v1/razorpay-webhook`
3. Active events: check **payment.captured**.
4. Set a webhook secret (Razorpay generates one, or you choose one) and add
   it as a third Supabase secret:
   ```bash
   supabase secrets set RAZORPAY_WEBHOOK_SECRET=your_webhook_secret_here
   ```

## 6. Try it

1. As the auction owner, end an auction that has bids and a winning amount
   under Rs 10,00,000.
2. Sign in as the winning bidder and open that auction — a "Pay [amount] now"
   button appears next to the winner banner.
3. Use a Razorpay test card (any of https://razorpay.com/docs/payments/payments/test-card-upi-details/)
   to complete checkout.
4. The auction should show "payment received" within a second or two.

## What this does *not* change

Winning amounts that convert to more than Rs 10,00,000 still work exactly as
before: the bidder ticks the payment-acknowledgement box when bidding, and
the owner marks payment received manually from the auction's edit page.
Nothing about that flow was touched.
