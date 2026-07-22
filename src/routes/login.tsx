import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { AuthShell, Alert } from "@/components/auth-shell";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: "Log in — BetMaster" },
      { name: "description", content: "Log in to your BetMaster account." },
    ],
  }),
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const { user, isApproved, loading } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // Already signed in? Skip the form. Approved users land on the Calculator,
  // everyone else on the approval screen.
  useEffect(() => {
    if (loading || !user) return;
    navigate({ to: isApproved ? "/calculator" : "/pending", replace: true });
  }, [loading, user, isApproved, navigate]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) {
      setError(error.message);
      return;
    }
    // The auth listener refreshes the profile; the effect above then routes to
    // /calculator or /pending depending on approval status.
    navigate({ to: "/calculator", replace: true });
  };

  return (
    <AuthShell title="Welcome back" subtitle="Log in to your BetMaster account.">
      {error && <Alert tone="error">{error}</Alert>}

      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="label" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="input"
          />
        </div>

        <div>
          <label className="label" htmlFor="password">
            Password
          </label>
          <input
            id="password"
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="input"
          />
        </div>

        <button
          type="submit"
          disabled={busy}
          className="btn-primary w-full justify-center disabled:opacity-60"
        >
          {busy ? "Signing in…" : "Log in"}
        </button>
      </form>

      <div className="mt-5 flex flex-col gap-1 text-sm text-muted-foreground">
        <Link to="/reset-password" className="text-primary hover:underline">
          Forgot password?
        </Link>
        <span>
          No account?{" "}
          <Link to="/register" className="text-primary hover:underline">
            Join now
          </Link>
        </span>
      </div>
    </AuthShell>
  );
}
