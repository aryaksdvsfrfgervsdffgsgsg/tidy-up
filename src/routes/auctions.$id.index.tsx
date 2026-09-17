import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { MessageCircle, Send, Trophy } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { SiteHeader } from "@/components/site-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  PAYMENT_ACK_THRESHOLD_INR,
  canPayViaGateway,
  checkInvariant,
  createRazorpayOrder,
  deleteAuction,
  getAuction,
  hasWinner,
  joinPrivateAuction,
  verifyRazorpayPayment,
  listBids,
  listMessages,
  listParticipants,
  nextMinimum,
  placeBid,
  reasonText,
  sendMessage,
  type Bid,
  type InvariantReport,
} from "@/lib/auction-api";
import { CURRENCY_CODES, convert, ensureRates, formatMoney, getCachedRates, type RateTable } from "@/lib/currency";

export const Route = createFileRoute("/auctions/$id/")({
  head: () => ({
    meta: [
      { title: "Live auction — BidBlock" },
      {
        name: "description",
        content:
          "Follow the current price, watch every bid land live, and place your own bid in one tap.",
      },
      { property: "og:title", content: "Live auction — BidBlock" },
      {
        property: "og:description",
        content: "Follow the current price, watch every bid land live, and place your own bid.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AuctionPage,
});

function AuctionPage() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [user, setUser] = useState<User | null>(null);
  const [amount, setAmount] = useState("");
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [messageError, setMessageError] = useState<string | null>(null);
  const [sendingMessage, setSendingMessage] = useState(false);
  const [stressCount, setStressCount] = useState(200);
  const [stressRunning, setStressRunning] = useState(false);
  const [stressSummary, setStressSummary] = useState<{
    accepted: number;
    rejected: number;
    ms: number;
  } | null>(null);
  const [report, setReport] = useState<InvariantReport | null>(null);
  const [stressRows, setStressRows] = useState<Bid[]>([]);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const [displayCurrency, setDisplayCurrency] = useState<string | null>(null);
  const [rates, setRates] = useState<RateTable | null>(getCachedRates());
  const [paymentAck, setPaymentAck] = useState(false);
  const [joinBusy, setJoinBusy] = useState(false);
  const [joinNotice, setJoinNotice] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [payBusy, setPayBusy] = useState(false);
  const [payNotice, setPayNotice] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUser(data.user ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) =>
      setUser(session?.user ?? null),
    );
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    ensureRates().then((r) => r && setRates(r));
  }, []);

  const auctionQuery = useQuery({
    queryKey: ["auction", id],
    queryFn: () => getAuction(id),
    refetchInterval: 4000,
  });
  const bidsQuery = useQuery({
    queryKey: ["bids", id],
    queryFn: () => listBids(id),
    refetchInterval: 4000,
  });
  const messagesQuery = useQuery({
    queryKey: ["auction-messages", id],
    queryFn: () => listMessages(id),
    refetchInterval: 10000,
  });
  const participantsQuery = useQuery({
    queryKey: ["participants", id],
    queryFn: () => listParticipants(id),
    enabled: !!user,
  });

  // Live feed: push updates the instant a bid lands, no refresh needed.
  useEffect(() => {
    const channel = supabase
      .channel(`auction-${id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "bids", filter: `auction_id=eq.${id}` },
        () => {
          queryClient.invalidateQueries({ queryKey: ["bids", id] });
          queryClient.invalidateQueries({ queryKey: ["auction", id] });
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "auctions", filter: `id=eq.${id}` },
        () => queryClient.invalidateQueries({ queryKey: ["auction", id] }),
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "auction_messages", filter: `auction_id=eq.${id}` },
        () => queryClient.invalidateQueries({ queryKey: ["auction-messages", id] }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [id, queryClient]);

  const auction = auctionQuery.data;
  const bids = bidsQuery.data ?? [];
  const messages = messagesQuery.data ?? [];
  const isOwner = !!user && !!auction && user.id === auction.owner_id;
  const minimum = auction ? nextMinimum(auction) : 0;
  const hasEnded = !!auction?.ends_at && new Date(auction.ends_at).getTime() <= Date.now();
  const hasStarted = !auction?.starts_at || new Date(auction.starts_at).getTime() <= Date.now();
  const acceptsBids =
    (auction?.status === "live" || auction?.status === "scheduled") &&
    !hasEnded &&
    hasStarted &&
    !auction?.locked;

  const currency = displayCurrency ?? auction?.listing_currency ?? "USD";
  const showAmount = (value: number) => {
    if (!auction) return formatMoney(value, currency);
    if (currency === auction.listing_currency) return formatMoney(value, currency);
    const converted = convert(value, auction.listing_currency, currency, rates);
    return converted === null
      ? `${formatMoney(value, auction.listing_currency)} (rate unavailable in ${currency})`
      : formatMoney(converted, currency);
  };

  const myParticipation = (participantsQuery.data ?? []).find((p) => p.user_id === user?.id);
  const isParticipant = isOwner || myParticipation?.status === "joined";
  const canViewBidForm = !auction || auction.visibility === "public" || isParticipant;

  const enteredAmountInr = auction && amount ? convert(Number(amount), auction.listing_currency, "INR", rates) : null;
  const needsPaymentAck = enteredAmountInr !== null && enteredAmountInr >= PAYMENT_ACK_THRESHOLD_INR;

  const winningAmountInr = auction ? convert(Number(auction.current_price), auction.listing_currency, "INR", rates) : null;
  const canPayNow =
    !!auction &&
    canPayViaGateway(auction, user?.id) &&
    winningAmountInr !== null &&
    winningAmountInr <= PAYMENT_ACK_THRESHOLD_INR;

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [messages.length]);

  async function submitBid(e: React.FormEvent) {
    e.preventDefault();
    if (!auction) return;
    setSubmitting(true);
    setNotice(null);
    const value = Number(amount);
    const result = await placeBid(auction.id, value, auction.listing_currency, paymentAck);
    setSubmitting(false);
    if (result.ok) {
      setNotice({
        kind: "ok",
        text: `Bid accepted at ${formatMoney(result.amount, auction.listing_currency)} (#${result.seq})`,
      });
      setAmount("");
      setPaymentAck(false);
    } else {
      setNotice({ kind: "err", text: reasonText(result.reason) });
    }
    queryClient.invalidateQueries({ queryKey: ["auction", id] });
    queryClient.invalidateQueries({ queryKey: ["bids", id] });
  }

  async function joinAuction() {
    if (!auction) return;
    setJoinBusy(true);
    setJoinNotice(null);
    const result = await joinPrivateAuction(auction.id);
    setJoinBusy(false);
    if (result.ok) {
      queryClient.invalidateQueries({ queryKey: ["participants", id] });
    } else {
      setJoinNotice(reasonText(result.reason));
    }
  }

  async function removeAuction() {
    if (!auction) return;
    setDeleting(true);
    try {
      await deleteAuction(auction.id);
      queryClient.invalidateQueries({ queryKey: ["auctions"] });
      queryClient.invalidateQueries({ queryKey: ["my-auctions"] });
      navigate({ to: "/manage", replace: true });
    } catch (err) {
      setDeleting(false);
      setNotice({ kind: "err", text: err instanceof Error ? err.message : "Couldn't delete this auction." });
    }
  }

  function loadRazorpayCheckout(): Promise<void> {
    if ((window as unknown as { Razorpay?: unknown }).Razorpay) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://checkout.razorpay.com/v1/checkout.js";
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("Couldn't load Razorpay's checkout script."));
      document.body.appendChild(script);
    });
  }

  async function payNow() {
    if (!auction) return;
    setPayBusy(true);
    setPayNotice(null);
    try {
      const order = await createRazorpayOrder(auction.id);
      if (!order.ok) {
        setPayNotice(order.reason);
        setPayBusy(false);
        return;
      }
      await loadRazorpayCheckout();
      const Razorpay = (window as unknown as { Razorpay: new (opts: Record<string, unknown>) => { open: () => void } }).Razorpay;
      const checkout = new Razorpay({
        key: order.key_id,
        order_id: order.order_id,
        amount: order.amount_paise,
        currency: order.currency,
        name: "BidBlock",
        description: `Winning bid — ${order.auction_title}`,
        prefill: { email: user?.email ?? "" },
        theme: { color: "#0f172a" },
        handler: async (response: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) => {
          const result = await verifyRazorpayPayment(response);
          if (result.ok) {
            setPayNotice(null);
            queryClient.invalidateQueries({ queryKey: ["auction", id] });
          } else {
            // Already a full sentence from the edge function, not a short code.
            setPayNotice(result.reason);
          }
          setPayBusy(false);
        },
        modal: { ondismiss: () => setPayBusy(false) },
      });
      checkout.open();
    } catch (err) {
      setPayBusy(false);
      setPayNotice(err instanceof Error ? err.message : "Couldn't start the payment.");
    }
  }

  async function submitMessage(e: React.FormEvent) {
    e.preventDefault();
    const content = message.trim();
    if (!user || !content) return;
    setSendingMessage(true);
    setMessageError(null);
    try {
      await sendMessage(id, user.id, content);
      setMessage("");
      await queryClient.invalidateQueries({ queryKey: ["auction-messages", id] });
    } catch (error) {
      setMessageError(error instanceof Error ? error.message : "Message could not be sent.");
    } finally {
      setSendingMessage(false);
    }
  }

  async function runStress() {
    if (!auction) return;
    setStressRunning(true);
    setReport(null);
    setStressSummary(null);
    setStressRows([]);
    const started = performance.now();
    const fresh = await getAuction(auction.id);
    const base = fresh ? nextMinimum(fresh) : minimum;
    const firstSeq = fresh?.last_seq ?? auction.last_seq;
    const step = Number(auction.min_increment);
    // Fire everything at once: each attempt races the others for a position.
    const results = await Promise.all(
      Array.from({ length: stressCount }, (_, i) =>
        placeBid(auction.id, base + i * step, auction.listing_currency, true),
      ),
    );
    const accepted = results.filter((r) => r.ok).length;
    setStressSummary({
      accepted,
      rejected: results.length - accepted,
      ms: Math.round(performance.now() - started),
    });
    const [invariant, rows] = await Promise.all([
      checkInvariant(auction.id),
      listBids(auction.id, Math.min(1000, stressCount + 10)),
    ]);
    setReport(invariant);
    setStressRows(rows.filter((bid) => bid.seq > firstSeq).sort((a, b) => a.seq - b.seq));
    setStressRunning(false);
    queryClient.invalidateQueries({ queryKey: ["auction", id] });
    queryClient.invalidateQueries({ queryKey: ["bids", id] });
  }

  if (auctionQuery.isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <SiteHeader />
        <p className="mx-auto max-w-3xl px-4 py-10 text-sm text-muted-foreground">Loading…</p>
      </div>
    );
  }

  if (!auction) {
    return (
      <div className="min-h-screen bg-background">
        <SiteHeader />
        <div className="mx-auto max-w-3xl px-4 py-10">
          <h1 className="text-xl font-semibold">Auction not found</h1>
          <Button asChild className="mt-4">
            <Link to="/">Back to auctions</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main className="mx-auto w-full max-w-5xl px-4 py-5 sm:py-10">
        <div className="rounded-lg border border-border bg-card p-5 sm:p-7">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{auction.title}</h1>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                <span className="rounded-full bg-muted px-2 py-0.5 font-mono text-[11px] uppercase text-muted-foreground">
                  {auction.visibility}
                </span>
                {auction.item_count > 1 && (
                  <span className="rounded-full bg-muted px-2 py-0.5 font-mono text-[11px] uppercase text-muted-foreground">
                    {auction.item_count} items
                  </span>
                )}
                {auction.locked && (
                  <span className="rounded-full bg-destructive/15 px-2 py-0.5 font-mono text-[11px] uppercase text-destructive">
                    locked
                  </span>
                )}
              </div>
            </div>
            <span
              className={`shrink-0 rounded-full px-2 py-0.5 font-mono text-[11px] uppercase ${
                  acceptsBids
                  ? "bg-success/15 text-success"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              {!hasStarted ? "upcoming" : acceptsBids ? "live" : "ended"}
            </span>
          </div>
          {auction.description && (
            <p className="mt-2 text-sm text-muted-foreground">{auction.description}</p>
          )}
          {auction.starts_at && !hasStarted && (
            <p className="mt-3 font-mono text-xs text-muted-foreground">
              Starts {new Date(auction.starts_at).toLocaleString()}
            </p>
          )}
          {auction.ends_at && (
            <p className="mt-1 font-mono text-xs text-muted-foreground">
              {hasEnded ? "Ended" : "Ends"} {new Date(auction.ends_at).toLocaleString()}
            </p>
          )}

          {hasWinner(auction) && (
            <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-success/30 bg-success/10 p-4">
              <Trophy aria-hidden="true" className="size-6 shrink-0 text-success" />
              <div className="flex-1">
                <p className="text-sm font-semibold text-success">Won by {auction.leader_name}</p>
                <p className="font-mono text-xs text-muted-foreground">
                  Winning bid: {showAmount(Number(auction.current_price))}
                  {auction.payment_confirmed_at && " · payment received"}
                </p>
                {payNotice && <p className="mt-1 text-xs text-destructive">{payNotice}</p>}
              </div>
              {canPayNow && (
                <Button size="sm" onClick={payNow} disabled={payBusy}>
                  {payBusy
                    ? "Opening checkout…"
                    : `Pay ${formatMoney(winningAmountInr as number, "INR")} now`}
                </Button>
              )}
            </div>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-2">
            {isOwner && (
              <>
                <Button variant="outline" size="sm" asChild>
                  <Link to="/auctions/$id/edit" params={{ id }}>Edit auction</Link>
                </Button>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="outline" size="sm" className="text-destructive hover:text-destructive">
                      Delete auction
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete "{auction.title}"?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This permanently removes the auction along with its bids, chat, and invite list.
                        This can't be undone.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={removeAuction}
                        disabled={deleting}
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      >
                        {deleting ? "Deleting…" : "Delete auction"}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </>
            )}
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Show prices in</span>
              <Select value={currency} onValueChange={setDisplayCurrency}>
                <SelectTrigger className="h-8 w-28 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  {CURRENCY_CODES.map((code) => (
                    <SelectItem key={code} value={code}>
                      {code}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat
              label="Current price"
              value={showAmount(Number(auction.bid_count === 0 ? auction.starting_price : auction.current_price))}
              accent
            />
            <Stat label="Next minimum" value={showAmount(minimum)} />
            <Stat label="Bids" value={String(auction.bid_count)} />
            <Stat label="Sequence" value={`#${auction.last_seq}`} />
          </div>

          {auction.locked && (
            <p className="mt-6 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              The owner has locked this auction. No new bids are being accepted right now.
            </p>
          )}

          {!user ? (
            <div className="mt-6 flex items-center gap-3 rounded-lg border border-border bg-muted/40 p-3 text-sm">
              <span className="text-muted-foreground">Sign in to place a bid.</span>
              <Button size="sm" asChild>
                <Link to="/auth">Sign in</Link>
              </Button>
            </div>
          ) : !canViewBidForm ? (
            <div className="mt-6 rounded-lg border border-border bg-muted/40 p-3 text-sm">
              {myParticipation ? (
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-muted-foreground">You're invited to this private auction.</span>
                  <Button size="sm" onClick={joinAuction} disabled={joinBusy}>
                    {joinBusy ? "Joining…" : "Accept invite & bid"}
                  </Button>
                </div>
              ) : (
                <span className="text-muted-foreground">
                  This is a private auction. Ask the owner to invite you before you can bid.
                </span>
              )}
              {joinNotice && <p className="mt-2 text-xs text-destructive">{joinNotice}</p>}
            </div>
          ) : (
            <form onSubmit={submitBid} className="mt-6">
              <div className="grid grid-cols-[1fr_auto] gap-2 sm:grid-cols-[1fr_auto_auto]">
                <Input
                  inputMode="decimal"
                  type="number"
                  min={minimum}
                  step="0.01"
                  required
                  aria-label="Bid amount"
                  placeholder={`${formatMoney(minimum, auction.listing_currency)} or more`}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="h-11 font-mono text-lg"
                />
                <Button type="button" variant="secondary" className="h-11" onClick={() => setAmount(String(minimum))}>
                  Use min
                </Button>
                <Button type="submit" className="col-span-2 h-11 sm:col-span-1" disabled={submitting || !acceptsBids}>
                    {submitting ? "Placing…" : "Place bid"}
                </Button>
              </div>
              {needsPaymentAck && (
                <label className="mt-3 flex items-start gap-2 rounded-lg border border-border bg-muted/40 p-3 text-sm">
                  <Checkbox
                    checked={paymentAck}
                    onCheckedChange={(checked) => setPaymentAck(checked === true)}
                    className="mt-0.5"
                  />
                  <span>
                    This bid is ₹10,00,000 or more (as converted). I agree to complete payment if I win —
                    the owner will confirm payment with me directly; there's no payment gateway here.
                  </span>
                </label>
              )}
            </form>
          )}

          {notice && (
            <p
              className={`mt-3 text-sm ${notice.kind === "ok" ? "text-success" : "text-destructive"}`}
            >
              {notice.text}
            </p>
          )}
        </div>

        <div className="mt-6 grid items-start gap-6 lg:grid-cols-2">
        <section className="rounded-lg border border-border bg-card p-5 sm:p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold tracking-tight">Live bid feed</h2>
            <span className="font-mono text-xs text-muted-foreground">{bids.length} shown</span>
          </div>
          <div className="mt-3 max-h-96 overflow-y-auto rounded-lg border border-border">
            {bids.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">No bids yet — be the first.</p>
            ) : (
              <ul className="divide-y divide-border">
                {bids.map((bid) => (
                  <li
                    key={bid.id}
                    className="flex items-center justify-between gap-3 px-4 py-2 text-sm"
                  >
                    <span className="font-mono text-xs text-muted-foreground">#{bid.seq}</span>
                    <span className="flex-1 truncate">{bid.bidder_name}</span>
                    <span className="font-mono text-primary">{formatMoney(Number(bid.amount), auction.listing_currency)}</span>
                    <span className="hidden font-mono text-xs text-muted-foreground sm:inline">
                      {new Date(bid.created_at).toLocaleTimeString()}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <section className="rounded-lg border border-border bg-card p-5 sm:p-6">
          <div className="flex items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 text-lg font-semibold"><MessageCircle aria-hidden="true" className="size-5 text-primary" /> Live chat</h2>
            <span className="text-xs text-muted-foreground">{messages.length} messages</span>
          </div>
          <div className="mt-3 h-72 overflow-y-auto rounded-md border border-border bg-background/40 p-3">
            {messagesQuery.isLoading ? (
              <p className="text-sm text-muted-foreground">Loading chat…</p>
            ) : messages.length === 0 ? (
              <p className="text-sm text-muted-foreground">No messages yet. Start the conversation.</p>
            ) : (
              <ul className="space-y-3">
                {messages.map((chatMessage) => (
                  <li key={chatMessage.id} className={chatMessage.user_id === user?.id ? "text-right" : "text-left"}>
                    <div className={`inline-block max-w-[85%] rounded-md px-3 py-2 text-left text-sm ${chatMessage.user_id === user?.id ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"}`}>
                      <p className="text-xs font-medium opacity-75">{chatMessage.sender_name}</p>
                      <p className="break-words">{chatMessage.content}</p>
                      <p className="mt-1 font-mono text-[10px] opacity-60">{new Date(chatMessage.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <div ref={chatEndRef} />
          </div>
          {user ? (
            <form onSubmit={submitMessage} className="mt-3 flex gap-2">
              <Input aria-label="Chat message" maxLength={500} required placeholder="Message bidders…" value={message} onChange={(e) => setMessage(e.target.value)} />
              <Button type="submit" size="icon" disabled={sendingMessage || !message.trim()} aria-label="Send message"><Send aria-hidden="true" /></Button>
            </form>
          ) : (
            <Button className="mt-3 w-full" variant="secondary" asChild><Link to="/auth">Sign in to chat</Link></Button>
          )}
          {messageError && <p className="mt-2 text-sm text-destructive">{messageError}</p>}
        </section>
        </div>

        {isOwner && (
          <section className="mt-6 rounded-lg border border-border bg-card p-5 sm:p-7">
            <h2 className="text-lg font-semibold tracking-tight">Load test (owner only)</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Fires bids at the database all at once, then verifies that every accepted bid has a
              unique, gapless position and a strictly higher price.
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Input
                type="number"
                min={10}
                max={1000}
                value={stressCount}
                onChange={(e) => setStressCount(Number(e.target.value))}
                className="w-28 font-mono"
              />
              <Button onClick={runStress} disabled={stressRunning}>
                {stressRunning ? "Running…" : "Fire concurrent bids"}
              </Button>
            </div>
            {stressSummary && (
              <p className="mt-3 font-mono text-sm">
                accepted {stressSummary.accepted} · rejected {stressSummary.rejected} ·{" "}
                {stressSummary.ms}ms
              </p>
            )}
            {report && (
              <div
                className={`mt-3 rounded-lg border p-3 text-sm ${
                  report.ok
                    ? "border-success/40 bg-success/10 text-success"
                    : "border-destructive/40 bg-destructive/10 text-destructive"
                }`}
              >
                {report.ok
                  ? `Invariant holds — ${report.accepted} accepted bids, highest position #${report.max_seq}, zero violations.`
                  : `Violations found: ${report.violations.join(", ")}`}
              </div>
            )}
            {stressRows.length > 0 && (
              <div className="mt-4 overflow-hidden rounded-md border border-border">
                <div className="grid grid-cols-[5rem_1fr_1.25fr] border-b border-border bg-muted/60 px-3 py-2 font-mono text-xs text-muted-foreground">
                  <span>seq</span><span>amount</span><span>at</span>
                </div>
                <div className="max-h-72 overflow-y-auto">
                  {stressRows.map((bid) => (
                    <div key={bid.id} className="grid grid-cols-[5rem_1fr_1.25fr] border-b border-border px-3 py-2 font-mono text-xs last:border-b-0">
                      <span>#{bid.seq}</span>
                      <span className="text-primary">{formatMoney(Number(bid.amount), auction.listing_currency)}</span>
                      <span className="text-muted-foreground">{new Date(bid.created_at).toLocaleTimeString()}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>
        )}
      </main>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`font-mono text-xl ${accent ? "text-primary" : "text-foreground"}`}>{value}</p>
    </div>
  );
}
