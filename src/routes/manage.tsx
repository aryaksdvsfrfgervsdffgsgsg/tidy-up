import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";

import { supabase } from "@/integrations/supabase/client";
import { SiteHeader } from "@/components/site-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import {
  deleteAuction,
  friendlyDbError,
  hasWinner,
  listOwnedAuctions,
  setAuctionLock,
  money,
  type Auction,
} from "@/lib/auction-api";
import { CURRENCY_CODES, currencyLabel } from "@/lib/currency";

export const Route = createFileRoute("/manage")({
  head: () => ({
    meta: [
      { title: "Personal auctions — BidBlock" },
      {
        name: "description",
        content: "Create auctions, set the minimum increment, and close bidding when you're done.",
      },
      { property: "og:title", content: "Personal auctions — BidBlock" },
      {
        property: "og:description",
        content: "Create auctions, set the minimum increment, and close bidding when you're done.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ManagePage,
});

function ManagePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [startingPrice, setStartingPrice] = useState("100");
  const [minIncrement, setMinIncrement] = useState("5");
  const [listingCurrency, setListingCurrency] = useState("USD");
  const [itemCount, setItemCount] = useState("1");
  const [visibility, setVisibility] = useState<"public" | "private">("public");
  const [participantLimit, setParticipantLimit] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setUser(data.user ?? null);
      setReady(true);
      if (!data.user) navigate({ to: "/auth", replace: true });
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) =>
      setUser(session?.user ?? null),
    );
    return () => sub.subscription.unsubscribe();
  }, [navigate]);

  const myAuctions = useQuery({
    queryKey: ["my-auctions", user?.id],
    enabled: !!user,
    queryFn: async () => (user ? listOwnedAuctions(user.id) : []),
  });

  async function createAuction(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    setSaving(true);
    setError(null);
    const isScheduled = !!startsAt && new Date(startsAt).getTime() > Date.now();
    const { error: err } = await supabase.from("auctions").insert({
      owner_id: user.id,
      title: title.trim(),
      description: description.trim(),
      starting_price: Number(startingPrice),
      min_increment: Number(minIncrement),
      current_price: Number(startingPrice),
      status: isScheduled ? "scheduled" : "live",
      listing_currency: listingCurrency,
      item_count: Math.max(1, Number(itemCount) || 1),
      visibility,
      participant_limit: visibility === "private" && participantLimit ? Number(participantLimit) : null,
      starts_at: startsAt ? new Date(startsAt).toISOString() : null,
    });
    setSaving(false);
    if (err) {
      setError(friendlyDbError(err));
      return;
    }
    setTitle("");
    setDescription("");
    setParticipantLimit("");
    setStartsAt("");
    queryClient.invalidateQueries({ queryKey: ["my-auctions", user.id] });
    queryClient.invalidateQueries({ queryKey: ["auctions"] });
  }

  async function setStatus(auction: Auction, status: string) {
    await supabase.from("auctions").update({ status }).eq("id", auction.id);
    queryClient.invalidateQueries({ queryKey: ["my-auctions", user?.id] });
    queryClient.invalidateQueries({ queryKey: ["auctions"] });
  }

  async function toggleLock(auction: Auction) {
    await setAuctionLock(auction.id, !auction.locked);
    queryClient.invalidateQueries({ queryKey: ["my-auctions", user?.id] });
    queryClient.invalidateQueries({ queryKey: ["auctions"] });
    queryClient.invalidateQueries({ queryKey: ["auction", auction.id] });
  }

  async function removeAuction(auction: Auction) {
    setDeletingId(auction.id);
    try {
      await deleteAuction(auction.id);
      queryClient.invalidateQueries({ queryKey: ["my-auctions", user?.id] });
      queryClient.invalidateQueries({ queryKey: ["auctions"] });
    } finally {
      setDeletingId(null);
    }
  }

  if (!ready || !user) {
    return (
      <div className="min-h-screen bg-background">
        <SiteHeader />
        <p className="mx-auto max-w-3xl px-4 py-10 text-sm text-muted-foreground">Loading…</p>
      </div>
    );
  }

  const auctions = myAuctions.data ?? [];

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main className="mx-auto w-full max-w-3xl px-4 py-6 sm:py-10">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Personal auctions</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Auctions you own — public or private. Manage invites for a private auction from{" "}
          <Link to="/private" className="underline underline-offset-4">
            Private auctions
          </Link>
          .
        </p>

        <form
          onSubmit={createAuction}
          className="mt-5 space-y-4 rounded-2xl border border-border bg-card p-5 sm:p-7"
        >
          <h2 className="text-lg font-semibold tracking-tight">Create an auction</h2>
          <div className="space-y-2">
            <Label htmlFor="title">Title</Label>
            <Input
              id="title"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="1968 Gibson ES-335"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Condition, provenance, shipping…"
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="start">Starting price</Label>
              <Input
                id="start"
                type="number"
                min="0"
                step="0.01"
                required
                value={startingPrice}
                onChange={(e) => setStartingPrice(e.target.value)}
                className="font-mono"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="inc">Minimum increment</Label>
              <Input
                id="inc"
                type="number"
                min="0.01"
                step="0.01"
                required
                value={minIncrement}
                onChange={(e) => setMinIncrement(e.target.value)}
                className="font-mono"
              />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="currency">Listing currency</Label>
              <Select value={listingCurrency} onValueChange={setListingCurrency}>
                <SelectTrigger id="currency">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  {CURRENCY_CODES.map((code) => (
                    <SelectItem key={code} value={code}>
                      {currencyLabel(code)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Viewers can toggle to see this converted into their own currency.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="items">How many items should this auction bid?</Label>
              <Input
                id="items"
                type="number"
                min="1"
                step="1"
                value={itemCount}
                onChange={(e) => setItemCount(e.target.value)}
                className="font-mono"
              />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="visibility">Visibility</Label>
              <Select value={visibility} onValueChange={(v) => setVisibility(v as "public" | "private")}>
                <SelectTrigger id="visibility">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="public">Public — anyone can find and bid</SelectItem>
                  <SelectItem value="private">Private — invite only</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {visibility === "private" && (
              <div className="space-y-2">
                <Label htmlFor="limit">Participant limit</Label>
                <Input
                  id="limit"
                  type="number"
                  min="1"
                  step="1"
                  placeholder="No limit"
                  value={participantLimit}
                  onChange={(e) => setParticipantLimit(e.target.value)}
                  className="font-mono"
                />
              </div>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="starts">Starts at (optional)</Label>
            <Input
              id="starts"
              type="datetime-local"
              value={startsAt}
              onChange={(e) => setStartsAt(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Leave blank to go live immediately. A future time lists the auction under "Upcoming" until then.
            </p>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" disabled={saving}>
            {saving ? "Creating…" : "Create auction"}
          </Button>
        </form>

        <div className="mt-8 space-y-3">
          {myAuctions.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {!myAuctions.isLoading && auctions.length === 0 && (
            <p className="text-sm text-muted-foreground">You haven't created any auctions yet.</p>
          )}
          {auctions.map((auction) => (
            <div
              key={auction.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-4"
            >
              <div className="min-w-0">
                <Link
                  to="/auctions/$id"
                  params={{ id: auction.id }}
                  className="font-semibold tracking-tight hover:text-primary"
                >
                  {auction.title}
                </Link>
                <p className="font-mono text-xs text-muted-foreground">
                  {money(
                    Number(auction.bid_count === 0 ? auction.starting_price : auction.current_price),
                    auction.listing_currency,
                  )}{" "}
                  · {auction.bid_count} bids · +{money(Number(auction.min_increment), auction.listing_currency)} ·{" "}
                  {auction.status}
                  {auction.locked ? " · locked" : ""} · {auction.visibility}
                  {auction.item_count > 1 ? ` · ${auction.item_count} items` : ""}
                </p>
                {hasWinner(auction) && (
                  <p className="mt-0.5 text-xs font-medium text-success">Won by {auction.leader_name}</p>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {auction.status === "live" || auction.status === "scheduled" ? (
                  <Button size="sm" variant="secondary" onClick={() => setStatus(auction, "ended")}>
                    End
                  </Button>
                ) : (
                  <Button size="sm" variant="secondary" onClick={() => setStatus(auction, "live")}>
                    Reopen
                  </Button>
                )}
                <Button size="sm" variant={auction.locked ? "default" : "outline"} onClick={() => toggleLock(auction)}>
                  {auction.locked ? "Unlock" : "Lock"}
                </Button>
                <Button size="sm" asChild>
                  <Link to="/auctions/$id" params={{ id: auction.id }}>
                    Open
                  </Link>
                </Button>
                <Button size="sm" variant="outline" asChild>
                  <Link to="/auctions/$id/edit" params={{ id: auction.id }}>
                    Edit
                  </Link>
                </Button>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button size="sm" variant="outline" className="text-destructive hover:text-destructive">
                      Delete
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
                        onClick={() => removeAuction(auction)}
                        disabled={deletingId === auction.id}
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      >
                        {deletingId === auction.id ? "Deleting…" : "Delete"}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
