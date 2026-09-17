// Shared by create-razorpay-order, verify-razorpay-payment, and
// razorpay-webhook. Not deployed as its own function (the `_` prefix on the
// folder tells the Supabase CLI to skip it).

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-razorpay-signature",
};

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function hmacSha256Hex(message: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return toHex(signature);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

/** Verifies the signature Razorpay Checkout.js hands back to the client on
 * success: HMAC_SHA256(order_id + "|" + payment_id, key_secret). This is what
 * proves the payment actually happened and wasn't just a client claiming so. */
export async function verifyCheckoutSignature(
  orderId: string,
  paymentId: string,
  signature: string,
  keySecret: string,
): Promise<boolean> {
  const expected = await hmacSha256Hex(`${orderId}|${paymentId}`, keySecret);
  return timingSafeEqual(expected, signature);
}

/** Verifies a Razorpay webhook request: HMAC_SHA256(raw request body,
 * webhook_secret). Must run against the exact raw body text — re-serializing
 * parsed JSON can reorder keys and break the signature. */
export async function verifyWebhookSignature(
  rawBody: string,
  signature: string,
  webhookSecret: string,
): Promise<boolean> {
  const expected = await hmacSha256Hex(rawBody, webhookSecret);
  return timingSafeEqual(expected, signature);
}
