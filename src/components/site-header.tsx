import { Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

export function SiteHeader() {
  const [user, setUser] = useState<User | null>(null);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUser(data.user ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  async function signOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  return (
    <header className="sticky top-0 z-30 border-b border-border/70 bg-background/85 backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between gap-3 px-4">
        <Link to="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <span className="grid h-7 w-7 place-items-center rounded-md bg-primary font-mono text-sm text-primary-foreground">
            B
          </span>
          <span className="hidden sm:inline">BidBlock</span>
        </Link>
        <nav className="flex items-center gap-1.5 text-sm">
          <Link
            to="/"
            className="rounded-md px-2.5 py-1.5 text-muted-foreground transition-colors hover:text-foreground"
          >
            Public auctions
          </Link>
          {user ? (
            <>
              <Link
                to="/manage"
                className="rounded-md px-2.5 py-1.5 text-muted-foreground transition-colors hover:text-foreground"
              >
                Personal auctions
              </Link>
              <Link
                to="/private"
                className="rounded-md px-2.5 py-1.5 text-muted-foreground transition-colors hover:text-foreground"
              >
                Private auctions
              </Link>
              <Button variant="secondary" size="sm" onClick={signOut}>
                Sign out
              </Button>
            </>
          ) : (
            <Button size="sm" asChild>
              <Link to="/auth">Sign in</Link>
            </Button>
          )}
        </nav>
      </div>
    </header>
  );
}
