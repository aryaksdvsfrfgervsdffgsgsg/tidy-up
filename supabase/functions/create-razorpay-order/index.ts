// POST { auction_id: string }
// Only the auction's winner, for an ended auction with a winning amount that
// converts to Rs 10,00,000 or less, can create an order. That cap is checked
// here — not just in the UI — because the UI can be bypassed.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/razorpay.ts";

const GATEWAY_MAX_INR = 1_000_000;

async function inrAmount(amount: number, currency: string): Promise<number | null> {
  if (currency === "INR") return amount;
  try {
    const res = await fetch(`https://api.frankfurter.dev/v1/latest?base=${currency}&symbols=INR`);
    if (!res.ok) return null;
    const data = (await res.json()) as { rates?: Record<string, number> };
    const rate = data.rates?.INR;
    return rate ? amount * rate : null;
  } catch {
    return null;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const keyId = Deno.env.get("RAZORPAY_KEY_ID");
    const keySecret = Deno.env.get("RAZORPAY_KEY_SECRET");
    if (!keyId || !keySecret) {
      return json({ ok: false, reason: "Razorpay isn't configured on this server yet (missing API keys)." }, 500);
    }

    const authClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } },
    );
    const { data: userData, error: userError } = await authClient.auth.getUser();
    if (userError || !userData.user) return json({ ok: false, reason: "not_signed_in" }, 401);
    const user = userData.user;

    const { auction_id } = (await req.json()) as { auction_id?: string };
    if (!auction_id) return json({ ok: false, reason: "auction_id is required" }, 400);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: auction, error: auctionError } = await admin
      .from("auctions")
      .select("id, title, status, bid_count, leader_id, current_price, listing_currency, payment_confirmed_at")
      .eq("id", auction_id)
      .maybeSingle();
    if (auctionError) return json({ ok: false, reason: auctionError.message }, 500);
    if (!auction) return json({ ok: false, reason: "no_such_auction" }, 404);
    if (auction.status !== "ended" || auction.bid_count === 0) {
      return json({ ok: false, reason: "This auction hasn't ended with a winner yet." }, 400);
    }
    if (auction.leader_id !== user.id) {
      return json({ ok: false, reason: "Only the winning bidder can pay for this auction." }, 403);
    }
    if (auction.payment_confirmed_at) {
      return json({ ok: false, reason: "This auction is already marked as paid." }, 400);
    }

    const amountInr = await inrAmount(Number(auction.current_price), auction.listing_currency);
    if (amountInr === null) {
      return json({ ok: false, reason: "Couldn't determine the INR amount to charge. Try again shortly." }, 502);
    }
    if (amountInr <= 0 || amountInr > GATEWAY_MAX_INR) {
      return json(
        {
          ok: false,
          reason: `Razorpay checkout is only available for winning amounts up to Rs 10,00,000. This auction's winning amount converts to about Rs ${amountInr.toFixed(2)} — use the manual "mark payment received" step instead.`,
        },
        400,
      );
    }

    // Reuse an existing pending order for this auction rather than creating a
    // duplicate (the DB has a partial unique index enforcing this too).
    const { data: existing } = await admin
      .from("auction_payments")
      .select("razorpay_order_id, amount_inr, status")
      .eq("auction_id", auction_id)
      .eq("status", "created")
      .maybeSingle();

    if (existing) {
      return json({
        ok: true,
        order_id: existing.razorpay_order_id,
        amount_paise: Math.round(Number(existing.amount_inr) * 100),
        currency: "INR",
        key_id: keyId,
        auction_title: auction.title,
      });
    }

    const amountPaise = Math.round(amountInr * 100);
    const orderRes = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${btoa(`${keyId}:${keySecret}`)}`,
      },
      body: JSON.stringify({
        amount: amountPaise,
        currency: "INR",
        receipt: auction_id,
        notes: { auction_id, auction_title: auction.title, payer_id: user.id },
      }),
    });
    const order = await orderRes.json();
    if (!orderRes.ok) {
      return json({ ok: false, reason: order?.error?.description ?? "Razorpay rejected the order." }, 502);
    }

    const { error: insertError } = await admin.from("auction_payments").insert({
      auction_id,
      payer_id: user.id,
      amount_inr: amountInr,
      razorpay_order_id: order.id,
      status: "created",
    });
    if (insertError) return json({ ok: false, reason: insertError.message }, 500);

    return json({
      ok: true,
      order_id: order.id,
      amount_paise: amountPaise,
      currency: "INR",
      key_id: keyId,
      auction_title: auction.title,
    });
  } catch (err) {
    return json({ ok: false, reason: err instanceof Error ? err.message : "Unexpected error." }, 500);
  }
});

// Always responds 200: supabase.functions.invoke() from the browser treats any
// non-2xx as a thrown error and doesn't reliably expose a parsed JSON body
// across SDK versions, so ok:true/false in the body is the real signal, not
// the HTTP status. The second argument is kept only as inline documentation
// of what a REST caller would conventionally expect.
function json(body: unknown, _conventionalStatus = 200) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
