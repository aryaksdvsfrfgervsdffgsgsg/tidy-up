// Configure this URL as a webhook in the Razorpay dashboard, subscribed to
// the "payment.captured" event, with its own Webhook Secret (separate from
// the API Key Secret) set as RAZORPAY_WEBHOOK_SECRET.
//
// Called directly by Razorpay's servers, not by the browser — there's no
// Supabase user session here. Authenticity comes entirely from the webhook
// signature, verified against the exact raw request body.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyWebhookSignature } from "../_shared/razorpay.ts";

serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const webhookSecret = Deno.env.get("RAZORPAY_WEBHOOK_SECRET");
  if (!webhookSecret) return new Response("Webhook not configured", { status: 500 });

  const signature = req.headers.get("x-razorpay-signature");
  const rawBody = await req.text();
  if (!signature || !(await verifyWebhookSignature(rawBody, signature, webhookSecret))) {
    return new Response("Invalid signature", { status: 400 });
  }

  const event = JSON.parse(rawBody) as {
    event?: string;
    payload?: { payment?: { entity?: { id?: string; order_id?: string; status?: string } } };
  };

  if (event.event !== "payment.captured") {
    return new Response("ignored", { status: 200 }); // acknowledge, nothing to do
  }

  const paymentEntity = event.payload?.payment?.entity;
  const orderId = paymentEntity?.order_id;
  const paymentId = paymentEntity?.id;
  if (!orderId || !paymentId) return new Response("Malformed payload", { status: 400 });

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const { data: payment } = await admin
    .from("auction_payments")
    .select("id, auction_id, payer_id, status")
    .eq("razorpay_order_id", orderId)
    .maybeSingle();
  if (!payment) return new Response("No matching order", { status: 404 });
  if (payment.status === "paid") return new Response("already processed", { status: 200 }); // idempotent

  await admin
    .from("auction_payments")
    .update({ status: "paid", razorpay_payment_id: paymentId, paid_at: new Date().toISOString() })
    .eq("id", payment.id);

  await admin
    .from("auctions")
    .update({ payment_confirmed_at: new Date().toISOString(), payment_confirmed_by: payment.payer_id })
    .eq("id", payment.auction_id)
    .is("payment_confirmed_at", null);

  return new Response("ok", { status: 200 });
});
