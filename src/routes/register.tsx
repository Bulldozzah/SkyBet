import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { Mail, Lock, User } from "lucide-react";
import { AuthShell, Alert, IconField, PillButton } from "@/components/auth-shell";

export const Route = createFileRoute("/register")({
  head: () => ({
    meta: [
      { title: "Create account — SkyBet" },
      { name: "description", content: "Register to request access to the SkyBet calculator." },
    ],
  }),
  component: RegisterPage,
});

function RegisterPage() {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        // Stored on the auth user; the profiles row picks it up.
        data: { full_name: fullName },
        emailRedirectTo: `${window.location.origin}/login`,
      },
    });
    setBusy(false);
    if (error) setError(error.message);
    else setDone(true);
  };

  if (done) {
    return (
      <AuthShell
        title="Check your email"
        subtitle={
          <>
            We sent a confirmation link to <strong className="text-foreground">{email}</strong>.
            Confirm your email, then log in to continue.
          </>
        }
      >
        <Link
          to="/login"
          className="flex h-12 w-full items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground shadow-sm transition hover:bg-primary/90"
        >
          Go to sign in
        </Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Create your account" subtitle="Register to request access to the calculator.">
      {error && <Alert tone="error">{error}</Alert>}

      <form onSubmit={submit} className="space-y-4">
        <IconField
          id="fullName"
          icon={User}
          label="Full name"
          type="text"
          placeholder="Full name"
          autoComplete="name"
          required
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
        />

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
          placeholder="Password (6+ characters)"
          autoComplete="new-password"
          minLength={6}
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        <div className="pt-1">
          <PillButton type="submit" disabled={busy}>
            {busy ? "Creating…" : "Create account"}
          </PillButton>
        </div>
      </form>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link to="/login" className="font-medium text-primary hover:underline">
          Sign in
        </Link>
      </p>
    </AuthShell>
  );
}
