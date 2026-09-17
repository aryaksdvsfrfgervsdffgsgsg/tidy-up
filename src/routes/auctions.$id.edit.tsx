import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";

import { SiteHeader } from "@/components/site-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { supabase } from "@/integrations/supabase/client";
import {
  confirmAuctionPayment,
  deleteAuction,
  friendlyDbError,
  getAuction,
  reasonText,
  setAuctionLock,
  type Auction,
} from "@/lib/auction-api";

export const Route = createFileRoute("/auctions/$id/edit")({
  head: () => ({
    meta: [
      { title: "Edit auction — BidBlock" },
      { name: "description", content: "Update the price, bid increment, and closing time for your auction." },
      { property: "og:title", content: "Edit auction — BidBlock" },
      { property: "og:description", content: "Update an auction's pricing and closing time." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: EditAuctionPage,
});

function toLocalDateTime(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function EditAuctionPage() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [formAuction, setFormAuction] = useState<Auction | null>(null);
  const [startingPrice, setStartingPrice] = useState("");
  const [minIncrement, setMinIncrement] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [participantLimit, setParticipantLimit] = useState("");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [lockBusy, setLockBusy] = useState(false);
  const [paymentBusy, setPaymentBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setUser(data.user ?? null);
      setAuthReady(true);
    });
  }, []);

  const auctionQuery = useQuery({ queryKey: ["auction", id], queryFn: () => getAuction(id) });
  const auction = auctionQuery.data;

  useEffect(() => {
    if (!auction || formAuction?.id === auction.id) return;
    setFormAuction(auction);
    setStartingPrice(String(auction.starting_price));
    setMinIncrement(String(auction.min_increment));
    setEndsAt(toLocalDateTime(auction.ends_at));
    setStartsAt(toLocalDateTime(auction.starts_at));
    setParticipantLimit(auction.participant_limit ? String(auction.participant_limit) : "");
  }, [auction, formAuction]);

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ["auction", id] });
    if (user) await queryClient.invalidateQueries({ queryKey: ["my-auctions", user.id] });
    await queryClient.invalidateQueries({ queryKey: ["auctions"] });
  }

  async function saveAuction(event: React.FormEvent) {
    event.preventDefault();
    if (!auction || !user || user.id !== auction.owner_id) return;
    const start = Number(startingPrice);
    const increment = Number(minIncrement);
    if (!Number.isFinite(start) || start < 0 || !Number.isFinite(increment) || increment <= 0) {
      setNotice({ kind: "err", text: "Enter a valid starting price and an increment above zero." });
      return;
    }
    setSaving(true);
    setNotice(null);
    const updates = {
      starting_price: start,
      min_increment: increment,
      ends_at: endsAt ? new Date(endsAt).toISOString() : null,
      starts_at: startsAt ? new Date(startsAt).toISOString() : null,
      ...(auction.visibility === "private"
        ? { participant_limit: participantLimit ? Number(participantLimit) : null }
        : {}),
    };
    const { error } = await supabase.from("auctions").update(updates).eq("id", auction.id);
    setSaving(false);
    if (error) {
      setNotice({ kind: "err", text: friendlyDbError(error.message) });
      return;
    }
    setNotice({ kind: "ok", text: "Auction settings saved." });
    await refresh();
  }

  async function toggleLock() {
    if (!auction) return;
    setLockBusy(true);
    try {
      await setAuctionLock(auction.id, !auction.locked);
      await refresh();
    } finally {
      setLockBusy(false);
    }
  }

  async function markPaymentReceived() {
    if (!auction) return;
    setPaymentBusy(true);
    const result = await confirmAuctionPayment(auction.id);
    setPaymentBusy(false);
    if (result.ok) {
      setNotice({ kind: "ok", text: "Payment marked as received." });
      await refresh();
    } else {
      setNotice({ kind: "err", text: reasonText(result.reason) });
    }
  }

  async function removeAuction() {
    if (!auction) return;
    setDeleting(true);
    try {
      await deleteAuction(auction.id);
      if (user) queryClient.invalidateQueries({ queryKey: ["my-auctions", user.id] });
      queryClient.invalidateQueries({ queryKey: ["auctions"] });
      navigate({ to: "/manage", replace: true });
    } catch (err) {
      setDeleting(false);
      setNotice({ kind: "err", text: err instanceof Error ? err.message : "Couldn't delete this auction." });
    }
  }

  const loading = auctionQuery.isLoading || !authReady;
  const canEdit = !!auction && !!user && auction.owner_id === user.id;

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main className="mx-auto w-full max-w-2xl px-4 py-6 sm:py-10">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/manage">← My auctions</Link>
        </Button>
        {loading ? (
          <p className="mt-8 text-sm text-muted-foreground">Loading…</p>
        ) : !auction ? (
          <p className="mt-8 text-sm text-muted-foreground">Auction not found.</p>
        ) : !user ? (
          <div className="mt-8 border-t border-border pt-6">
            <h1 className="text-2xl font-semibold">Sign in to edit this auction</h1>
            <Button className="mt-4" asChild><Link to="/auth">Sign in</Link></Button>
          </div>
        ) : !canEdit ? (
          <p className="mt-8 text-sm text-destructive">Only the auction owner can edit these settings.</p>
        ) : (
          <form onSubmit={saveAuction} className="mt-6 border-t border-border pt-6">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-medium uppercase text-muted-foreground">Auction settings</p>
                <h1 className="mt-1 text-2xl font-semibold sm:text-3xl">{auction.title}</h1>
              </div>
              <Button
                type="button"
                variant={auction.locked ? "default" : "outline"}
                onClick={toggleLock}
                disabled={lockBusy}
              >
                {lockBusy ? "…" : auction.locked ? "Unlock bidding" : "Lock bidding"}
              </Button>
            </div>
            {auction.locked && (
              <p className="mt-2 text-xs text-muted-foreground">
                Bidding is locked — no new bids will be accepted until you unlock it.
              </p>
            )}
            <div className="mt-7 grid gap-5 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="edit-start">Starting price ({auction.listing_currency})</Label>
                <Input id="edit-start" type="number" min="0" step="0.01" required value={startingPrice} onChange={(e) => setStartingPrice(e.target.value)} className="font-mono" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-increment">Minimum increment</Label>
                <Input id="edit-increment" type="number" min="0.01" step="0.01" required value={minIncrement} onChange={(e) => setMinIncrement(e.target.value)} className="font-mono" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-start-at">Starts at</Label>
                <Input id="edit-start-at" type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-end">End time</Label>
                <Input id="edit-end" type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
                <p className="text-xs text-muted-foreground">Leave blank to keep bidding open until you end it manually.</p>
              </div>
              {auction.visibility === "private" && (
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="edit-limit">Participant limit</Label>
                  <Input
                    id="edit-limit"
                    type="number"
                    min="1"
                    step="1"
                    placeholder="No limit"
                    value={participantLimit}
                    onChange={(e) => setParticipantLimit(e.target.value)}
                    className="font-mono"
                  />
                  <p className="text-xs text-muted-foreground">
                    Manage who's invited from{" "}
                    <Link to="/private" className="underline underline-offset-4">
                      Private auctions
                    </Link>
                    .
                  </p>
                </div>
              )}
            </div>
            {auction.bid_count > 0 && <p className="mt-4 text-sm text-muted-foreground">This auction already has bids. Changing the starting price will not replace its current price.</p>}
            {notice && <p className={`mt-4 text-sm ${notice.kind === "ok" ? "text-success" : "text-destructive"}`}>{notice.text}</p>}
            <div className="mt-6 flex flex-col gap-2 sm:flex-row">
              <Button type="submit" disabled={saving}>{saving ? "Saving…" : "Save changes"}</Button>
              <Button variant="secondary" asChild><Link to="/auctions/$id" params={{ id }}>View auction</Link></Button>
            </div>

            {auction.status === "ended" && auction.bid_count > 0 && (
              <div className="mt-6 rounded-lg border border-border bg-muted/30 p-4">
                <p className="text-sm font-medium">Payment</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  For high-value bids the bidder acknowledged they'd pay if they won. This just records
                  that you've received payment from the winner — there's no payment gateway behind it.
                </p>
                {auction.payment_confirmed_at ? (
                  <p className="mt-2 text-sm text-success">
                    Marked received {new Date(auction.payment_confirmed_at).toLocaleString()}.
                  </p>
                ) : (
                  <Button type="button" size="sm" className="mt-2" onClick={markPaymentReceived} disabled={paymentBusy}>
                    {paymentBusy ? "…" : "Mark payment received"}
                  </Button>
                )}
              </div>
            )}

            <div className="mt-6 rounded-lg border border-destructive/30 bg-destructive/5 p-4">
              <p className="text-sm font-medium text-destructive">Danger zone</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Deleting an auction is permanent — its bids, chat history, and invite list go with it.
              </p>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button type="button" size="sm" variant="outline" className="mt-2 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive">
                    Delete this auction
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
            </div>
          </form>
        )}
      </main>
    </div>
  );
}
