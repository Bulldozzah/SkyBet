import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Mail, Lock } from "lucide-react";
import { AuthShell, Alert, IconField, PillButton } from "@/components/auth-shell";

export const Route = createFileRoute("/reset-password")({
  head: () => ({
    meta: [
      { title: "Reset password — SkyBet" },
      { name: "description", content: "Reset your SkyBet password." },
    ],
  }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"request" | "update">("request");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // Arriving via the recovery email fires PASSWORD_RECOVERY and establishes a
  // temporary session — that's the cue to show the "set new password" form.
  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setMode("update");
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const sendReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setMsg("");
    setBusy(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setBusy(false);
    if (error) setError(error.message);
    else setMsg("Password reset link sent. Check your email.");
  };

  const updatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) {
      setError(error.message);
    } else {
      setMsg("Password updated. Redirecting to login…");
      setTimeout(() => navigate({ to: "/login", replace: true }), 1500);
    }
  };

  return (
    <AuthShell title={mode === "request" ? "Reset password" : "Set new password"}>
      {error && <Alert tone="error">{error}</Alert>}
      {msg && <Alert tone="success">{msg}</Alert>}

      <form onSubmit={mode === "request" ? sendReset : updatePassword} className="space-y-4">
        {mode === "request" ? (
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
        ) : (
          <IconField
            id="newPassword"
            icon={Lock}
            label="New password"
            type="password"
            placeholder="New password (6+ characters)"
            autoComplete="new-password"
            minLength={6}
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        )}

        <PillButton type="submit" disabled={busy}>
          {busy ? "Working…" : mode === "request" ? "Send reset link" : "Update password"}
        </PillButton>
      </form>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        <Link to="/login" className="font-medium text-primary hover:underline">
          Back to sign in
        </Link>
      </p>
    </AuthShell>
  );
}
