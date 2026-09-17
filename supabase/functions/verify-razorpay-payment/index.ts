// POST { razorpay_order_id, razorpay_payment_id, razorpay_signature }
// Called from the client's Checkout.js success handler. This is the fast
// path for immediate UI feedback; razorpay-webhook is the authoritative async
// path in case the browser closes before this call completes.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, verifyCheckoutSignature } from "../_shared/razorpay.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const keySecret = Deno.env.get("RAZORPAY_KEY_SECRET");
    if (!keySecret) return json({ ok: false, reason: "Razorpay isn't configured on this server yet." }, 500);

    const authClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } },
    );
    const { data: userData, error: userError } = await authClient.auth.getUser();
    if (userError || !userData.user) return json({ ok: false, reason: "not_signed_in" }, 401);

    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = (await req.json()) as {
      razorpay_order_id?: string;
      razorpay_payment_id?: string;
      razorpay_signature?: string;
    };
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return json({ ok: false, reason: "Missing payment details from Razorpay." }, 400);
    }

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: payment, error: paymentError } = await admin
      .from("auction_payments")
      .select("id, auction_id, payer_id, status")
      .eq("razorpay_order_id", razorpay_order_id)
      .maybeSingle();
    if (paymentError) return json({ ok: false, reason: paymentError.message }, 500);
    if (!payment) return json({ ok: false, reason: "No matching order found." }, 404);
    if (payment.payer_id !== userData.user.id) {
      return json({ ok: false, reason: "This order belongs to a different account." }, 403);
    }
    if (payment.status === "paid") return json({ ok: true }); // already confirmed (e.g. by the webhook) — idempotent

    const valid = await verifyCheckoutSignature(razorpay_order_id, razorpay_payment_id, razorpay_signature, keySecret);
    if (!valid) {
      await admin
        .from("auction_payments")
        .update({ status: "failed", failure_reason: "signature_mismatch" })
        .eq("id", payment.id);
      return json({ ok: false, reason: "Payment verification failed. Contact the auction owner if you were charged." }, 400);
    }

    await admin
      .from("auction_payments")
      .update({
        status: "paid",
        razorpay_payment_id,
        razorpay_signature,
        paid_at: new Date().toISOString(),
      })
      .eq("id", payment.id);

    await admin
      .from("auctions")
      .update({ payment_confirmed_at: new Date().toISOString(), payment_confirmed_by: payment.payer_id })
      .eq("id", payment.auction_id)
      .is("payment_confirmed_at", null);

    return json({ ok: true });
  } catch (err) {
    return json({ ok: false, reason: err instanceof Error ? err.message : "Unexpected error." }, 500);
  }
});

// Always responds 200 — see the matching comment in create-razorpay-order;
// ok:true/false in the body is the real signal for supabase.functions.invoke().
function json(body: unknown, _conventionalStatus = 200) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
