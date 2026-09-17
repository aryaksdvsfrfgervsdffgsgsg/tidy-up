/* Simulated Razorpay-style checkout.
 *
 * No Razorpay account or API keys are involved: orders and payment ids are
 * generated locally with a `sim_` prefix, and no money ever moves. Everything
 * else about the flow is real — only the auction's winner can start a payment,
 * only the server writes to auction_payments, and the auction is marked paid
 * server-side. Swapping this for real Razorpay later means replacing the two
 * handlers below with API calls plus signature verification.
 */

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const GATEWAY_MAX_INR = 1_000_000;

export type SimulatedOrder =
  | { ok: true; order_id: string; amount_inr: number; auction_title: string; simulated: true }
  | { ok: false; reason: string };

export type SimulatedPaymentResult = { ok: true } | { ok: false; reason: string };

async function inrAmount(amount: number, currency: string): Promise<number | null> {
  if (currency === "INR") return amount;
  try {
    const res = await fetch(`https://api.frankfurter.dev/v1/latest?base=${currency}&symbols=INR`);
    if (!res.ok) return null;
    const data = (await res.json()) as { rates?: Record<string, number> };
    const rate = data.rates?.["INR"];
    return rate ? amount * rate : null;
  } catch {
    return null;
  }
}

const randomId = (prefix: string) =>
  `${prefix}_sim_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;

export const createSimulatedOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { auctionId: string }) => {
    if (!input?.auctionId) throw new Error("auctionId is required");
    return input;
  })
  .handler(async ({ data, context }): Promise<SimulatedOrder> => {
    const { supabase, userId } = context;

    const { data: auction, error } = await supabase
      .from("auctions")
      .select("id, title, status, bid_count, leader_id, current_price, listing_currency, payment_confirmed_at")
      .eq("id", data.auctionId)
      .maybeSingle();
    if (error) return { ok: false, reason: error.message };
    if (!auction) return { ok: false, reason: "That auction no longer exists." };
    if (auction.status !== "ended" || auction.bid_count === 0) {
      return { ok: false, reason: "This auction hasn't ended with a winner yet." };
    }
    if (auction.leader_id !== userId) {
      return { ok: false, reason: "Only the winning bidder can pay for this auction." };
    }
    if (auction.payment_confirmed_at) {
      return { ok: false, reason: "This auction is already marked as paid." };
    }

    const amountInr = await inrAmount(Number(auction.current_price), auction.listing_currency);
    if (amountInr === null) {
      return { ok: false, reason: "Couldn't work out the amount in rupees. Try again shortly." };
    }
    if (amountInr <= 0 || amountInr > GATEWAY_MAX_INR) {
      return {
        ok: false,
        reason: `Checkout is only available for winning amounts up to Rs 10,00,000. This one comes to about Rs ${amountInr.toFixed(2)} — use the manual "mark payment received" step instead.`,
      };
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: existing } = await supabaseAdmin
      .from("auction_payments")
      .select("razorpay_order_id, amount_inr")
      .eq("auction_id", data.auctionId)
      .eq("status", "created")
      .maybeSingle();

    if (existing) {
      return {
        ok: true,
        order_id: existing.razorpay_order_id,
        amount_inr: Number(existing.amount_inr),
        auction_title: auction.title,
        simulated: true,
      };
    }

    const orderId = randomId("order");
    const { error: insertError } = await supabaseAdmin.from("auction_payments").insert({
      auction_id: data.auctionId,
      payer_id: userId,
      amount_inr: amountInr,
      razorpay_order_id: orderId,
      status: "created",
    });
    if (insertError) return { ok: false, reason: insertError.message };

    return { ok: true, order_id: orderId, amount_inr: amountInr, auction_title: auction.title, simulated: true };
  });

export const settleSimulatedPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { orderId: string; outcome: "success" | "failure" }) => {
    if (!input?.orderId) throw new Error("orderId is required");
    if (input.outcome !== "success" && input.outcome !== "failure") throw new Error("invalid outcome");
    return input;
  })
  .handler(async ({ data, context }): Promise<SimulatedPaymentResult> => {
    const { userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: payment, error } = await supabaseAdmin
      .from("auction_payments")
      .select("id, auction_id, payer_id, status")
      .eq("razorpay_order_id", data.orderId)
      .maybeSingle();
    if (error) return { ok: false, reason: error.message };
    if (!payment) return { ok: false, reason: "That payment attempt no longer exists." };
    if (payment.payer_id !== userId) return { ok: false, reason: "This payment belongs to someone else." };
    if (payment.status !== "created") return { ok: false, reason: "This payment attempt is already closed." };

    if (data.outcome === "failure") {
      await supabaseAdmin
        .from("auction_payments")
        .update({ status: "failed", failure_reason: "Cancelled in the simulated checkout." })
        .eq("id", payment.id);
      return { ok: false, reason: "Payment was cancelled." };
    }

    const paidAt = new Date().toISOString();
    const { error: payError } = await supabaseAdmin
      .from("auction_payments")
      .update({ status: "paid", paid_at: paidAt, razorpay_payment_id: randomId("pay") })
      .eq("id", payment.id);
    if (payError) return { ok: false, reason: payError.message };

    const { error: auctionError } = await supabaseAdmin
      .from("auctions")
      .update({ payment_confirmed_at: paidAt, payment_confirmed_by: userId })
      .eq("id", payment.auction_id);
    if (auctionError) return { ok: false, reason: auctionError.message };

    return { ok: true };
  });
