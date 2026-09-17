import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";

import { supabase } from "@/integrations/supabase/client";
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
import {
  deleteAuction,
  hasWinner,
  inviteToAuction,
  isDatabaseUpToDate,
  joinPrivateAuction,
  listMyInvites,
  listOwnedPrivateAuctions,
  listParticipants,
  MIGRATION_REQUIRED_MESSAGE,
  money,
  reasonText,
  type Auction,
  type AuctionParticipant,
} from "@/lib/auction-api";

export const Route = createFileRoute("/private")({
  head: () => ({
    meta: [{ title: "Private auctions — BidBlock" }],
  }),
  component: PrivatePage,
});

function PrivatePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setUser(data.user ?? null);
      setReady(true);
      if (!data.user) navigate({ to: "/auth", replace: true });
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => setUser(session?.user ?? null));
    return () => sub.subscription.unsubscribe();
  }, [navigate]);

  const ownedPrivate = useQuery({
    queryKey: ["private-owned", user?.id],
    enabled: !!user,
    queryFn: async () => (user ? listOwnedPrivateAuctions(user.id) : []),
  });

  const invitedTo = useQuery({
    queryKey: ["private-invited", user?.id],
    enabled: !!user,
    queryFn: async () => (user ? listMyInvites(user.id) : []),
  });

  // The invite list and the private feed both quietly return nothing when the
  // database is behind, so surface the reason instead of an empty page.
  const schemaReady = useQuery({
    queryKey: ["schema-ready"],
    enabled: !!user,
    queryFn: isDatabaseUpToDate,
    staleTime: 60_000,
  });

  if (!ready || !user) {
    return (
      <div className="min-h-screen bg-background">
        <SiteHeader />
        <p className="mx-auto max-w-3xl px-4 py-10 text-sm text-muted-foreground">Loading…</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main className="mx-auto w-full max-w-3xl px-4 py-6 sm:py-10">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Private auctions</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Invite-only auctions you own, and invites sent to you. Create a private auction from{" "}
          <Link to="/manage" className="underline underline-offset-4">
            Personal auctions
          </Link>{" "}
          by setting its visibility.
        </p>

        {schemaReady.data === false && (
          <div className="mt-5 rounded-xl border border-destructive/40 bg-destructive/5 p-4">
            <p className="text-sm font-medium text-destructive">Database setup incomplete</p>
            <p className="mt-1 text-sm text-muted-foreground">{MIGRATION_REQUIRED_MESSAGE}</p>
          </div>
        )}

        <section className="mt-6">
          <h2 className="text-lg font-semibold tracking-tight">Your private auctions</h2>
          <div className="mt-3 space-y-3">
            {ownedPrivate.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
            {!ownedPrivate.isLoading && (ownedPrivate.data ?? []).length === 0 && (
              <p className="text-sm text-muted-foreground">You don't own any private auctions yet.</p>
            )}
            {(ownedPrivate.data ?? []).map((auction) => (
              <OwnedPrivateAuctionCard key={auction.id} auction={auction} queryClient={queryClient} />
            ))}
          </div>
        </section>

        <section className="mt-8">
          <h2 className="text-lg font-semibold tracking-tight">Invites you've received</h2>
          <div className="mt-3 space-y-3">
            {invitedTo.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
            {!invitedTo.isLoading && (invitedTo.data ?? []).length === 0 && (
              <p className="text-sm text-muted-foreground">No invites yet.</p>
            )}
            {(invitedTo.data ?? []).map((invite) => (
              <InviteCard
                key={invite.id}
                invite={invite}
                onJoined={() => {
                  queryClient.invalidateQueries({ queryKey: ["private-invited", user.id] });
                }}
              />
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}

function OwnedPrivateAuctionCard({
  auction,
  queryClient,
}: {
  auction: Auction;
  queryClient: ReturnType<typeof useQueryClient>;
}) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const participants = useQuery({
    queryKey: ["participants", auction.id],
    queryFn: () => listParticipants(auction.id),
  });

  const joined = (participants.data ?? []).filter((p) => p.status === "joined").length;

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setBusy(true);
    setNotice(null);
    const result = await inviteToAuction(auction.id, email.trim());
    setBusy(false);
    if (result.ok) {
      setNotice({ kind: "ok", text: "Invited." });
      setEmail("");
      queryClient.invalidateQueries({ queryKey: ["participants", auction.id] });
    } else {
      setNotice({ kind: "err", text: reasonText(result.reason) });
    }
  }

  async function removeAuction() {
    setDeleting(true);
    try {
      await deleteAuction(auction.id);
      queryClient.invalidateQueries({ queryKey: ["private-owned"] });
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link to="/auctions/$id" params={{ id: auction.id }} className="font-semibold hover:text-primary">
          {auction.title}
        </Link>
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs text-muted-foreground">
            {money(Number(auction.current_price || auction.starting_price), auction.listing_currency)} ·{" "}
            {joined}
            {auction.participant_limit ? `/${auction.participant_limit}` : ""} joined
          </span>
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
                  This permanently removes the auction along with its bids, chat, and invite list. This
                  can't be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={removeAuction}
                  disabled={deleting}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  {deleting ? "Deleting…" : "Delete"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>
      {hasWinner(auction) && (
        <p className="mt-1 text-xs font-medium text-success">Won by {auction.leader_name}</p>
      )}
      <form onSubmit={invite} className="mt-3 flex flex-wrap gap-2">
        <Input
          type="email"
          placeholder="bidder@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="max-w-xs"
        />
        <Button type="submit" size="sm" disabled={busy}>
          {busy ? "Inviting…" : "Invite"}
        </Button>
      </form>
      {notice && (
        <p className={`mt-2 text-sm ${notice.kind === "ok" ? "text-success" : "text-destructive"}`}>{notice.text}</p>
      )}
      {(participants.data ?? []).length > 0 && (
        <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
          {(participants.data ?? []).map((p) => (
            <li key={p.id} className="font-mono">
              {p.user_id.slice(0, 8)}… — {p.status}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function InviteCard({
  invite,
  onJoined,
}: {
  invite: AuctionParticipant & { auctions: Auction | null };
  onJoined: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const auction = invite.auctions;

  async function accept() {
    setBusy(true);
    setNotice(null);
    const result = await joinPrivateAuction(invite.auction_id);
    setBusy(false);
    if (result.ok) {
      onJoined();
    } else {
      setNotice(reasonText(result.reason));
    }
  }

  if (!auction) return null;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-4">
      <div>
        <p className="font-semibold">{auction.title}</p>
        <p className="font-mono text-xs text-muted-foreground">
          {money(Number(auction.current_price || auction.starting_price), auction.listing_currency)} · {invite.status}
        </p>
        {notice && <p className="mt-1 text-xs text-destructive">{notice}</p>}
      </div>
      {invite.status === "joined" ? (
        <Button size="sm" asChild>
          <Link to="/auctions/$id" params={{ id: auction.id }}>
            Open
          </Link>
        </Button>
      ) : (
        <Button size="sm" onClick={accept} disabled={busy}>
          {busy ? "Joining…" : "Accept invite"}
        </Button>
      )}
    </div>
  );
}
