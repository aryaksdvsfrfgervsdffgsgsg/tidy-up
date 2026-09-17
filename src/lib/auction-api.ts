import { supabase } from "@/integrations/supabase/client";
import { formatMoney, toInrEstimate } from "@/lib/currency";

export type Auction = {
  id: string;
  owner_id: string;
  title: string;
  description: string;
  starting_price: number;
  min_increment: number;
  current_price: number;
  leader_id: string | null;
  leader_name: string | null;
  last_seq: number;
  bid_count: number;
  status: string;
  ends_at: string | null;
  created_at: string;
  visibility: "public" | "private";
  participant_limit: number | null;
  item_count: number;
  locked: boolean;
  starts_at: string | null;
  listing_currency: string;
  payment_confirmed_at: string | null;
  payment_confirmed_by: string | null;
};

export type Bid = {
  id: string;
  auction_id: string;
  bidder_id: string;
  bidder_name: string;
  amount: number;
  seq: number;
  created_at: string;
  payment_ack: boolean;
  amount_inr: number | null;
};

export type AuctionMessage = {
  id: string;
  auction_id: string;
  user_id: string;
  sender_name: string;
  content: string;
  created_at: string;
};

export type AuctionParticipant = {
  id: string;
  auction_id: string;
  user_id: string;
  status: "invited" | "joined";
  invited_by: string | null;
  created_at: string;
  joined_at: string | null;
};

export type BidResult =
  | { ok: true; seq: number; amount: number; min_required: number }
  | { ok: false; reason: string; min_required?: number; current_price?: number };

export type SimpleResult = { ok: true } | { ok: false; reason: string };

export type InvariantReport = {
  ok: boolean;
  accepted: number;
  max_seq: number;
  violations: string[];
};

/** ₹10L — bids at or above this INR-equivalent require the payer to acknowledge
 * they'll complete payment if they win. There's no payment gateway behind this;
 * the owner confirms payment manually afterward via confirmAuctionPayment(). */
export const PAYMENT_ACK_THRESHOLD_INR = 1_000_000;

export const money = (value: number, currency = "USD") => formatMoney(value, currency);

/* ---------------------------------------------------------------------------
 * Schema-drift handling.
 *
 * Every 400 on /rest/v1/auctions and every 404 on /rest/v1/auction_participants
 * means the same thing: the database is still on migration 0002 and doesn't
 * have the columns/tables this code queries. Rather than throwing an opaque
 * "Bad Request" at the user, we detect that specific failure, keep the app
 * usable on the columns that do exist, and say plainly what needs running.
 * ------------------------------------------------------------------------- */

type DbError = { message?: string; code?: string; details?: string; hint?: string };

/** PostgREST/Postgres codes for "that column/table/function isn't there". */
const SCHEMA_DRIFT_CODES = new Set([
  "42703", // undefined_column
  "42P01", // undefined_table
  "42883", // undefined_function
  "PGRST200", // requested relationship not found
  "PGRST202", // function not found in schema cache
  "PGRST204", // column not found in schema cache
  "PGRST205", // table not found in schema cache
]);

export function isSchemaOutOfDate(error: unknown): boolean {
  if (!error) return false;
  const err = error as DbError;
  if (err.code && SCHEMA_DRIFT_CODES.has(err.code)) return true;
  const text = `${err.message ?? ""} ${err.details ?? ""} ${err.hint ?? ""}`;
  return /schema cache|does not exist|could not find|undefined column|undefined table/i.test(text);
}

export const MIGRATION_REQUIRED_MESSAGE =
  "This project's database is missing the newest tables and columns, so these " +
  "requests are rejected. Run apply_this_migration.sql (or " +
  "drizzle/migrations/0003_feature_expansion.sql) against the database, then reload the page.";

/** Fills in the columns added by migration 0003/0004 so a database that hasn't
 * been migrated yet still renders instead of crashing on undefined. */
function normalizeAuction(row: Record<string, unknown>): Auction {
  return {
    ...(row as unknown as Auction),
    visibility: (row["visibility"] as "public" | "private") ?? "public",
    participant_limit: (row["participant_limit"] as number | null) ?? null,
    item_count: (row["item_count"] as number) ?? 1,
    locked: (row["locked"] as boolean) ?? false,
    starts_at: (row["starts_at"] as string | null) ?? null,
    listing_currency: (row["listing_currency"] as string) ?? "USD",
    leader_name: (row["leader_name"] as string | null) ?? null,
    payment_confirmed_at: (row["payment_confirmed_at"] as string | null) ?? null,
    payment_confirmed_by: (row["payment_confirmed_by"] as string | null) ?? null,
  };
}

/** The public homepage feed: public, non-draft auctions only. Filtered
 * explicitly (not just left to RLS) so a signed-in owner never sees their own
 * private or draft auctions leak into the general public listing.
 *
 * If `visibility` doesn't exist yet the filter is dropped and the same rule is
 * applied client-side, so the homepage keeps working during a pending migration. */
export async function listAuctions(): Promise<Auction[]> {
  const { data, error } = await supabase
    .from("auctions")
    .select("*")
    .eq("visibility", "public")
    .neq("status", "draft")
    .order("created_at", { ascending: false });

  if (!error) return (data ?? []).map((row) => normalizeAuction(row as Record<string, unknown>));
  if (!isSchemaOutOfDate(error)) throw error;

  const legacy = await supabase
    .from("auctions")
    .select("*")
    .neq("status", "draft")
    .order("created_at", { ascending: false });
  if (legacy.error) throw legacy.error;
  return (legacy.data ?? [])
    .map((row) => normalizeAuction(row as Record<string, unknown>))
    .filter((auction) => auction.visibility === "public");
}

/** Auctions owned by one user, for the manage page. */
export async function listOwnedAuctions(ownerId: string): Promise<Auction[]> {
  const { data, error } = await supabase
    .from("auctions")
    .select("*")
    .eq("owner_id", ownerId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((row) => normalizeAuction(row as Record<string, unknown>));
}

/** Private auctions owned by one user. Falls back to an unfiltered owner query
 * when `visibility` is missing, so the page shows an empty list rather than an error. */
export async function listOwnedPrivateAuctions(ownerId: string): Promise<Auction[]> {
  const { data, error } = await supabase
    .from("auctions")
    .select("*")
    .eq("owner_id", ownerId)
    .eq("visibility", "private")
    .order("created_at", { ascending: false });

  if (!error) return (data ?? []).map((row) => normalizeAuction(row as Record<string, unknown>));
  if (isSchemaOutOfDate(error)) return [];
  throw error;
}

/** Invites received by one user, with the auction embedded. Returns an empty
 * list when auction_participants doesn't exist yet (the 404 you were seeing). */
export async function listMyInvites(
  userId: string,
): Promise<(AuctionParticipant & { auctions: Auction | null })[]> {
  const { data, error } = await supabase
    .from("auction_participants")
    .select("*, auctions(*)")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) {
    if (isSchemaOutOfDate(error)) return [];
    throw error;
  }

  return (data ?? []).map((row) => {
    const invite = row as unknown as AuctionParticipant & { auctions: Record<string, unknown> | null };
    return { ...invite, auctions: invite.auctions ? normalizeAuction(invite.auctions) : null };
  });
}

/** One cheap probe used to show a setup banner: does the database already have
 * migration 0003/0004 applied? */
export async function isDatabaseUpToDate(): Promise<boolean> {
  const { error } = await supabase
    .from("auction_participants")
    .select("id", { count: "exact", head: true })
    .limit(1);
  if (error && isSchemaOutOfDate(error)) return false;

  const columns = await supabase.from("auctions").select("id,visibility,leader_name").limit(1);
  return !(columns.error && isSchemaOutOfDate(columns.error));
}

export async function getAuction(id: string): Promise<Auction | null> {
  const { data, error } = await supabase.from("auctions").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data ? normalizeAuction(data as Record<string, unknown>) : null;
}

export async function listBids(auctionId: string, limit = 200): Promise<Bid[]> {
  const { data, error } = await supabase
    .from("bids")
    .select("*")
    .eq("auction_id", auctionId)
    .order("seq", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as Bid[];
}

export async function listMessages(auctionId: string, limit = 100): Promise<AuctionMessage[]> {
  const { data, error } = await supabase
    .from("auction_messages")
    .select("*")
    .eq("auction_id", auctionId)
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as AuctionMessage[];
}

export async function sendMessage(auctionId: string, userId: string, content: string) {
  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("id", userId)
    .maybeSingle();
  const { error } = await supabase.from("auction_messages").insert({
    auction_id: auctionId,
    user_id: userId,
    sender_name: profile?.display_name || "bidder",
    content: content.trim(),
  });
  if (error) throw error;
}

/**
 * Places a bid. `paymentAck` must be true when the bid's INR-equivalent value
 * is at or above ₹10L (see PAYMENT_ACK_THRESHOLD_INR) — the server enforces
 * this too, so a client that skips the check just gets `payment_ack_required`
 * back. The INR estimate is computed client-side from live FX rates purely to
 * decide whether the checkbox is required; it isn't a real money transfer.
 */
export async function placeBid(
  auctionId: string,
  amount: number,
  listingCurrency: string,
  paymentAck = false,
): Promise<BidResult> {
  const amountInr = await toInrEstimate(amount, listingCurrency);
  const { data, error } = await supabase.rpc("place_bid", {
    p_auction_id: auctionId,
    p_amount: amount,
    p_payment_ack: paymentAck,
    ...(amountInr === null ? {} : { p_amount_inr: amountInr }),
  });
  if (error) return { ok: false, reason: friendlyDbError(error) };
  return data as unknown as BidResult;
}

export async function checkInvariant(auctionId: string): Promise<InvariantReport> {
  const { data, error } = await supabase.rpc("check_auction_invariant", {
    p_auction_id: auctionId,
  });
  if (error) throw error;
  return data as unknown as InvariantReport;
}

export async function listParticipants(auctionId: string): Promise<AuctionParticipant[]> {
  const { data, error } = await supabase
    .from("auction_participants")
    .select("*")
    .eq("auction_id", auctionId)
    .order("created_at", { ascending: false });
  if (error) {
    if (isSchemaOutOfDate(error)) return [];
    throw error;
  }
  return (data ?? []) as AuctionParticipant[];
}

export async function inviteToAuction(auctionId: string, email: string): Promise<SimpleResult> {
  const { data, error } = await supabase.rpc("invite_to_auction", {
    p_auction_id: auctionId,
    p_email: email.trim(),
  });
  if (error) return { ok: false, reason: friendlyDbError(error) };
  return data as unknown as SimpleResult;
}

export async function joinPrivateAuction(auctionId: string): Promise<SimpleResult> {
  const { data, error } = await supabase.rpc("join_private_auction", {
    p_auction_id: auctionId,
  });
  if (error) return { ok: false, reason: friendlyDbError(error) };
  return data as unknown as SimpleResult;
}

export async function setAuctionLock(auctionId: string, locked: boolean) {
  const { error } = await supabase.from("auctions").update({ locked }).eq("id", auctionId);
  if (error) throw error;
}

/** Permanently deletes an auction (owner only — enforced by RLS). Cascades to
 * its bids, chat messages, participants, and history. */
export async function deleteAuction(auctionId: string) {
  const { error } = await supabase.from("auctions").delete().eq("id", auctionId);
  if (error) throw error;
}

export const hasWinner = (auction: Auction) =>
  auction.status === "ended" && auction.bid_count > 0 && !!auction.leader_name;

/** Turns Postgres/PostgREST's internal error text into something a site owner
 * can actually act on, for the specific case of a pending database migration. */
export function friendlyDbError(error: unknown): string {
  if (isSchemaOutOfDate(typeof error === "string" ? { message: error } : error)) {
    return MIGRATION_REQUIRED_MESSAGE;
  }
  if (typeof error === "string") return error;
  const err = error as { message?: string } | null;
  return err?.message || "Something went wrong talking to the database.";
}

export async function confirmAuctionPayment(auctionId: string): Promise<SimpleResult> {
  const { data, error } = await supabase.rpc("confirm_auction_payment", {
    p_auction_id: auctionId,
  });
  if (error) return { ok: false, reason: friendlyDbError(error) };
  return data as unknown as SimpleResult;
}

/* ---------------------------------------------------------------------------
 * Simulated Razorpay-style checkout — the winner "pays" after the auction
 * ends, for winning amounts up to Rs 10,00,000. No Razorpay account, keys or
 * real money are involved; see src/lib/payments.functions.ts. Above the
 * ceiling nothing changes: the owner confirms payment manually via
 * confirmAuctionPayment() above.
 * ------------------------------------------------------------------------- */

export type { SimulatedOrder, SimulatedPaymentResult } from "./payments.functions";
export { createSimulatedOrder, settleSimulatedPayment } from "./payments.functions";

export const canPayViaGateway = (auction: Auction, userId: string | undefined) =>
  !!userId &&
  auction.status === "ended" &&
  auction.leader_id === userId &&
  !auction.payment_confirmed_at;

export const nextMinimum = (auction: Auction) =>
  auction.bid_count === 0
    ? Number(auction.starting_price)
    : Number(auction.current_price) + Number(auction.min_increment);

export const isUpcoming = (auction: Auction) =>
  auction.status === "scheduled" && !!auction.starts_at && new Date(auction.starts_at).getTime() > Date.now();

export const reasonText = (reason: string) => {
  switch (reason) {
    case "not_signed_in":
      return "Sign in to place a bid.";
    case "too_low":
      return "Someone outbid you — your amount is below the new minimum.";
    case "auction_not_live":
      return "This auction isn't open for bids.";
    case "auction_ended":
      return "This auction has ended.";
    case "auction_locked":
      return "The owner has locked this auction — no new bids are being accepted.";
    case "not_started":
      return "This auction hasn't started yet.";
    case "not_a_participant":
      return "This is a private auction — you need to accept an invite before bidding.";
    case "payment_ack_required":
      return "Bids of ₹10,00,000 or more need the payment acknowledgement checked.";
    case "no_such_auction":
      return "Auction not found.";
    case "no_such_private_auction":
      return "Private auction not found.";
    case "not_invited":
      return "You haven't been invited to this auction.";
    case "participant_limit_reached":
      return "This private auction has reached its participant limit.";
    case "not_owner":
      return "Only the auction owner can do that.";
    case "no_such_user":
      return "No account found with that email.";
    default:
      return reason;
  }
};
