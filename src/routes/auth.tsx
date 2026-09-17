import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { supabase } from "@/integrations/supabase/client";
import { SiteHeader } from "@/components/site-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in — BidBlock live auctions" },
      {
        name: "description",
        content: "Create a BidBlock account to bid on live auctions and run your own sales.",
      },
      { property: "og:title", content: "Sign in — BidBlock live auctions" },
      {
        property: "og:description",
        content: "Create a BidBlock account to bid on live auctions and run your own sales.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AuthPage,
});

/** Supabase returns HTTP 422 from /auth/v1/signup for several very different
 * situations (address already registered, password too weak, address rejected,
 * signups turned off). The raw message is often unhelpful, so map the known
 * codes to something a person can act on. */
function authErrorMessage(err: unknown): string {
  const e = err as { code?: string; status?: number; message?: string };
  switch (e?.code) {
    case "user_already_exists":
    case "email_exists":
      return "That email already has an account — sign in instead, or use “Forgot password?”.";
    case "weak_password":
      return "Pick a stronger password: at least 6 characters, and not a common one.";
    case "email_address_invalid":
      return "That email address was rejected. Use a real, deliverable address (test domains like example.com are blocked).";
    case "signup_disabled":
      return "New signups are turned off for this project. Enable email signups in the Auth settings.";
    case "over_email_send_rate_limit":
    case "over_request_rate_limit":
      return "Too many attempts in a short window. Wait a minute and try again.";
    case "invalid_credentials":
      return "Email or password is incorrect.";
    case "email_not_confirmed":
      return "Confirm your email first — check your inbox for the link.";
    default:
      break;
  }
  const message = e?.message ?? "";
  if (/already registered|already been registered/i.test(message)) {
    return "That email already has an account — sign in instead, or use “Forgot password?”.";
  }
  if (e?.status === 422) {
    return message || "The signup details were rejected. Check the email address and password and try again.";
  }
  return message || "Something went wrong.";
}

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup" | "forgot">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) navigate({ to: "/", replace: true });
    });
  }, [navigate]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    const cleanEmail = email.trim().toLowerCase();
    try {
      if (mode === "forgot") {
        const { error: resetError } = await supabase.auth.resetPasswordForEmail(cleanEmail, {
          redirectTo: `${window.location.origin}/auth/reset-password`,
        });
        if (resetError) throw resetError;
        setNotice("If that email has an account, a reset link is on its way.");
        return;
      }
      if (mode === "signup") {
        if (password.length < 6) {
          setError("Password must be at least 6 characters.");
          return;
        }
        const { data, error: signUpError } = await supabase.auth.signUp({
          email: cleanEmail,
          password,
          options: {
            emailRedirectTo: window.location.origin,
            data: { display_name: displayName.trim() || cleanEmail.split("@")[0] },
          },
        });
        if (signUpError) throw signUpError;
        // An "identity-less" user object means the address is already taken and
        // email confirmation is on; Supabase returns 200 here to avoid leaking
        // which addresses exist.
        if (data.user && (data.user.identities?.length ?? 0) === 0) {
          setMode("signin");
          setNotice("That email already has an account — sign in below.");
          return;
        }
        if (!data.session) {
          setNotice("Check your email to confirm your account, then sign in.");
          return;
        }
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: cleanEmail,
          password,
        });
        if (signInError) throw signInError;
      }
      navigate({ to: "/", replace: true });
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main className="mx-auto w-full max-w-md px-4 py-10">
        <h1 className="text-2xl font-semibold tracking-tight">
          {mode === "signin" ? "Welcome back" : mode === "signup" ? "Create your account" : "Reset your password"}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {mode === "forgot"
            ? "Enter your email and we'll send you a reset link."
            : "Bidding and running auctions both need an account."}
        </p>

        <form onSubmit={submit} className="mt-6 space-y-4 rounded-xl border border-border bg-card p-5">
          {mode === "signup" && (
            <div className="space-y-1.5">
              <Label htmlFor="name">Display name</Label>
              <Input
                id="name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Shown next to your bids"
                autoComplete="nickname"
              />
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
            />
          </div>
          {mode !== "forgot" && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="password">Password</Label>
                {mode === "signin" && (
                  <button
                    type="button"
                    className="text-xs text-muted-foreground underline-offset-4 hover:underline"
                    onClick={() => {
                      setMode("forgot");
                      setError(null);
                      setNotice(null);
                    }}
                  >
                    Forgot password?
                  </button>
                )}
              </div>
              <Input
                id="password"
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={mode === "signin" ? "current-password" : "new-password"}
              />
            </div>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}
          {notice && <p className="text-sm text-success">{notice}</p>}

          <Button type="submit" className="w-full" disabled={busy}>
            {busy
              ? "Working…"
              : mode === "signin"
                ? "Sign in"
                : mode === "signup"
                  ? "Create account"
                  : "Send reset link"}
          </Button>

          <button
            type="button"
            className="w-full text-center text-sm text-muted-foreground underline-offset-4 hover:underline"
            onClick={() => {
              setMode(mode === "signup" ? "signin" : mode === "forgot" ? "signin" : "signup");
              setError(null);
              setNotice(null);
            }}
          >
            {mode === "signin" ? "No account yet? Sign up" : "Already registered? Sign in"}
          </button>
        </form>
      </main>
    </div>
  );
}
