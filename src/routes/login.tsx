import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Mail, Lock } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { AuthShell, Alert, IconField, PillButton } from "@/components/auth-shell";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: "Sign in — SkyBet" },
      { name: "description", content: "Sign in to your SkyBet account." },
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
    <AuthShell
      title="Sign in"
      subtitle="Welcome back! Please sign in to continue."
      background="#1d4268"
    >
      {error && <Alert tone="error">{error}</Alert>}

      <form onSubmit={submit} className="space-y-4">
        <IconField
          id="email"
          icon={Mail}
          label="Email address"
          type="email"
          placeholder="Email address"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />

        <IconField
          id="password"
          icon={Lock}
          label="Password"
          type="password"
          placeholder="Password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        <div className="flex justify-end pt-1">
          <Link to="/reset-password" className="text-sm text-primary hover:underline">
            Forgot password?
          </Link>
        </div>

        <PillButton type="submit" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </PillButton>
      </form>

      <p className="mt-6 text-center text-sm text-slate-300">
        Don’t have an account?{" "}
        <Link to="/register" className="font-medium text-primary hover:underline">
          Sign up
        </Link>
      </p>
    </AuthShell>
  );
}
