import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, CheckCheck, Gavel } from "lucide-react";
import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";

import { SiteHeader } from "@/components/site-header";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/notifications")({
  head: () => ({ meta: [
    { title: "Notifications — BidBlock" },
    { name: "description", content: "Your live auction bid and closing alerts." },
    { property: "og:title", content: "Notifications — BidBlock" },
    { property: "og:description", content: "Your live auction bid and closing alerts." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ]}),
  component: NotificationsPage,
});

function NotificationsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [user, setUser] = useState<User | null>(null);
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setUser(data.user ?? null);
      if (!data.user) navigate({ to: "/auth", replace: true });
    });
  }, [navigate]);
  const query = useQuery({
    queryKey: ["notifications", user?.id], enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase.from("notifications").select("*").order("created_at", { ascending: false }).limit(100);
      if (error) throw error;
      return data ?? [];
    },
  });
  useEffect(() => {
    if (!user) return;
    const channel = supabase.channel(`notifications:${user.id}`).on("postgres_changes", { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${user.id}` }, () => queryClient.invalidateQueries({ queryKey: ["notifications"] })).subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [queryClient, user]);
  async function markAllRead() {
    if (!user) return;
    await supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("user_id", user.id).is("read_at", null);
    await queryClient.invalidateQueries({ queryKey: ["notifications"] });
  }
  const items = query.data ?? [];
  return <div className="min-h-screen bg-background"><SiteHeader />
    <main className="mx-auto w-full max-w-3xl px-4 py-8">
      <div className="flex items-center justify-between gap-4"><div><p className="text-sm font-semibold text-primary">ACTIVITY CENTER</p><h1 className="text-3xl font-bold">Notifications</h1></div><Button variant="outline" onClick={markAllRead}><CheckCheck /> Mark all read</Button></div>
      <div className="mt-7 space-y-2">
        {items.length === 0 && <div className="border border-dashed border-border p-8 text-center text-muted-foreground"><Bell className="mx-auto mb-3" />No auction alerts yet.</div>}
        {items.map((item) => <Link key={item.id} to={item.auction_id ? "/auctions/$id" : "/"} params={item.auction_id ? { id: item.auction_id } : {}} className={`flex gap-4 border p-4 transition-colors hover:bg-accent ${item.read_at ? "border-border bg-card" : "border-primary/50 bg-primary/10"}`} onClick={() => supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("id", item.id)}>
          <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-md ${item.notification_type === "auction_closed" ? "bg-destructive/15 text-destructive" : "bg-success/15 text-success"}`}><Gavel className="h-5 w-5" /></span>
          <span className="min-w-0"><strong className="block">{item.title}</strong><span className="block text-sm text-muted-foreground">{item.body}</span><time className="mt-1 block font-mono text-xs text-muted-foreground">{new Date(item.created_at).toLocaleString()}</time></span>
        </Link>)}
      </div>
    </main>
  </div>;
}