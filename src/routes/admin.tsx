import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Search, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";

import { SiteHeader } from "@/components/site-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { getAdminOverview, updateAdminRole } from "@/lib/admin.functions";
import { money } from "@/lib/auction-api";

export const Route = createFileRoute("/admin")({
  head: () => ({ meta: [
    { title: "Administration — BidBlock" },
    { name: "description", content: "Secure auction, bid, and account administration." },
    { property: "og:title", content: "Administration — BidBlock" },
    { property: "og:description", content: "Secure auction, bid, and account administration." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ]}),
  component: AdminPage,
});

function AdminPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const getOverview = useServerFn(getAdminOverview);
  const setAdmin = useServerFn(updateAdminRole);
  const [ready, setReady] = useState(false);
  const [filters, setFilters] = useState({ from: "", to: "", minPrice: "", maxPrice: "", bidder: "", title: "", status: "" });
  const [applied, setApplied] = useState(filters);
  useEffect(() => { supabase.auth.getUser().then(({ data }) => { if (!data.user) navigate({ to: "/auth", replace: true }); else setReady(true); }); }, [navigate]);
  const query = useQuery({
    queryKey: ["admin-overview", applied], enabled: ready,
    queryFn: () => getOverview({ data: {
      from: applied.from ? new Date(`${applied.from}T00:00:00`).toISOString() : undefined,
      to: applied.to ? new Date(`${applied.to}T23:59:59`).toISOString() : undefined,
      minPrice: applied.minPrice ? Number(applied.minPrice) : undefined,
      maxPrice: applied.maxPrice ? Number(applied.maxPrice) : undefined,
      bidder: applied.bidder || undefined, title: applied.title || undefined, status: applied.status || undefined,
    } }),
    retry: false,
  });
  if (query.error) return <div className="min-h-screen bg-background"><SiteHeader /><main className="mx-auto max-w-3xl px-4 py-16 text-center"><ShieldCheck className="mx-auto mb-4 h-10 w-10 text-destructive"/><h1 className="text-2xl font-bold">Administrator access required</h1><p className="mt-2 text-muted-foreground">This area is restricted to selected administrators.</p></main></div>;
  const data = query.data;
  return <div className="min-h-screen bg-background"><SiteHeader /><main className="mx-auto w-full max-w-6xl px-4 py-8">
    <div className="flex items-end justify-between"><div><p className="text-sm font-semibold text-primary">CONTROL ROOM</p><h1 className="text-3xl font-bold">Administration</h1></div><ShieldCheck className="h-9 w-9 text-success" /></div>
    <form className="mt-6 grid gap-3 border border-border bg-card p-4 sm:grid-cols-4" onSubmit={(e) => { e.preventDefault(); setApplied(filters); }}>
      {([['title','Auction title'],['bidder','Bidder'],['minPrice','Minimum price'],['maxPrice','Maximum price']] as const).map(([key,label]) => <div key={key}><Label htmlFor={key}>{label}</Label><Input id={key} type={key.includes('Price') ? 'number' : 'text'} value={filters[key as keyof typeof filters]} onChange={(e) => setFilters({ ...filters, [key]: e.target.value })} /></div>)}
      <div><Label htmlFor="from">From</Label><Input id="from" type="date" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })}/></div>
      <div><Label htmlFor="to">To</Label><Input id="to" type="date" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })}/></div>
      <div><Label htmlFor="status">Status</Label><Input id="status" placeholder="live or ended" value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}/></div>
      <Button type="submit" className="self-end"><Search /> Apply filters</Button>
    </form>
    <div className="mt-5 grid grid-cols-3 gap-3">{[[data?.auctions.length ?? 0,'Auctions'],[data?.bids.length ?? 0,'Bids'],[data?.accounts.length ?? 0,'Accounts']].map(([n,l]) => <div key={l} className="border-l-4 border-primary bg-card p-4"><strong className="block font-mono text-2xl">{n}</strong><span className="text-sm text-muted-foreground">{l}</span></div>)}</div>
    <Tabs defaultValue="auctions" className="mt-6"><TabsList><TabsTrigger value="auctions">Auctions</TabsTrigger><TabsTrigger value="bids">Bids</TabsTrigger><TabsTrigger value="accounts">Accounts</TabsTrigger></TabsList>
      <TabsContent value="auctions" className="space-y-2">{data?.auctions.map((a) => <div key={a.id} className="grid gap-2 border border-border bg-card p-4 sm:grid-cols-[1fr_auto_auto]"><Link to="/auctions/$id" params={{id:a.id}} className="font-semibold hover:text-primary">{a.title}</Link><span className="font-mono">{money(Number(a.current_price))}</span><span className={a.status === 'live' ? 'text-success' : 'text-destructive'}>{a.status}</span></div>)}</TabsContent>
      <TabsContent value="bids" className="space-y-2">{data?.bids.map((b) => <div key={b.id} className="grid grid-cols-[auto_1fr_auto] gap-3 border-b border-border p-3"><span className="font-mono text-primary">#{b.seq}</span><span>{b.bidder_name}<small className="block text-muted-foreground">{new Date(b.created_at).toLocaleString()}</small></span><strong className="font-mono">{money(Number(b.amount))}</strong></div>)}</TabsContent>
      <TabsContent value="accounts" className="space-y-2">{data?.accounts.map((account) => <div key={account.id} className="flex flex-wrap items-center justify-between gap-3 border border-border bg-card p-4"><div><strong>{account.displayName || 'Unnamed account'}</strong><small className="block text-muted-foreground">{account.email}</small></div><Button size="sm" variant={account.role === 'admin' ? 'destructive' : 'outline'} disabled={account.id === data.currentUserId} onClick={async () => { await setAdmin({data:{userId:account.id,enabled:account.role !== 'admin'}}); await queryClient.invalidateQueries({queryKey:['admin-overview']}); }}>{account.role === 'admin' ? 'Remove admin' : 'Make admin'}</Button></div>)}</TabsContent>
    </Tabs>
  </main></div>;
}