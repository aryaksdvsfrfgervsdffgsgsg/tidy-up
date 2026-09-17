import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import { SiteHeader } from "@/components/site-header";
import { Button } from "@/components/ui/button";
import {
  friendlyDbError,
  hasWinner,
  isUpcoming,
  listAuctions,
  money,
  nextMinimum,
  type Auction,
} from "@/lib/auction-api";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "BidBlock — live auctions with real-time bidding" },
      {
        name: "description",
        content:
          "Browse live auctions, watch bids land in real time, and place your own from any device.",
      },
      { property: "og:title", content: "BidBlock — live auctions with real-time bidding" },
      {
        property: "og:description",
        content:
          "Browse live auctions, watch bids land in real time, and place your own from any device.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: HomePage,
});

function HomePage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["auctions"],
    queryFn: listAuctions,
    refetchInterval: 5000,
  });

  const auctions = data ?? [];
  const upcoming = auctions.filter(isUpcoming);
  const open = auctions.filter((a) => !isUpcoming(a));

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:py-12">
        <section className="rounded-2xl border border-border bg-card p-6 sm:p-8">
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            Live auctions, settled in order
          </h1>
          <p className="mt-3 max-w-2xl text-sm text-muted-foreground sm:text-base">
            Every bid is written through a single serialized path in the database, so the price only
            moves up and no two bids ever share a position — even when hundreds land at once. Only
            public auctions are listed here; private auctions are invite-only.
          </p>
          <div className="mt-5">
            <Button asChild>
              <Link to="/manage">Create an auction</Link>
            </Button>
          </div>
        </section>

        {isLoading && <p className="mt-6 text-sm text-muted-foreground">Loading auctions…</p>}
        {error && (
          <div className="mt-6 rounded-xl border border-destructive/40 bg-destructive/5 p-4">
            <p className="text-sm font-medium text-destructive">Couldn't load auctions.</p>
            <p className="mt-1 text-sm text-muted-foreground">{friendlyDbError(error)}</p>
          </div>
        )}

        {!isLoading && upcoming.length > 0 && (
          <>
            <h2 className="mt-10 text-lg font-semibold tracking-tight">Upcoming</h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              {upcoming.map((auction) => (
                <AuctionCard key={auction.id} auction={auction} />
              ))}
            </div>
          </>
        )}

        <h2 className="mt-10 text-lg font-semibold tracking-tight">Open auctions</h2>
        {!isLoading && open.length === 0 && (
          <p className="mt-4 text-sm text-muted-foreground">
            No open auctions right now. Create the first one.
          </p>
        )}
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {open.map((auction) => (
            <AuctionCard key={auction.id} auction={auction} />
          ))}
        </div>
      </main>
    </div>
  );
}

function AuctionCard({ auction }: { auction: Auction }) {
  const upcoming = isUpcoming(auction);
  return (
    <Link
      to="/auctions/$id"
      params={{ id: auction.id }}
      className="rounded-xl border border-border bg-card p-5 transition-colors hover:border-primary/60"
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-semibold tracking-tight">{auction.title}</h3>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 font-mono text-[11px] uppercase ${
            upcoming
              ? "bg-primary/15 text-primary"
              : auction.status === "live"
                ? "bg-success/15 text-success"
                : "bg-muted text-muted-foreground"
          }`}
        >
          {upcoming ? "upcoming" : auction.status}
        </span>
      </div>
      {auction.description && (
        <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{auction.description}</p>
      )}
      {upcoming && auction.starts_at && (
        <p className="mt-2 font-mono text-xs text-muted-foreground">
          Starts {new Date(auction.starts_at).toLocaleString()}
        </p>
      )}
      <div className="mt-4 flex items-end justify-between">
        <div>
          <p className="text-xs text-muted-foreground">
            {upcoming ? "Starting price" : "Current price"}
          </p>
          <p className="font-mono text-2xl text-primary">
            {money(
              Number(auction.bid_count === 0 ? auction.starting_price : auction.current_price),
              auction.listing_currency,
            )}
          </p>
        </div>
        <div className="text-right text-xs text-muted-foreground">
          <p>{auction.bid_count} bids</p>
          {hasWinner(auction) ? (
            <p className="font-medium text-success">Won by {auction.leader_name}</p>
          ) : (
            !upcoming && <p>next ≥ {money(nextMinimum(auction), auction.listing_currency)}</p>
          )}
          {auction.item_count > 1 && <p>{auction.item_count} items</p>}
        </div>
      </div>
    </Link>
  );
}
