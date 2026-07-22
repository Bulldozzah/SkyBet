import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { AuthShell, Alert } from "@/components/auth-shell";
import { RouteSpinner } from "@/components/protected-route";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/pending")({
  head: () => ({
    meta: [
      { title: "Awaiting approval — BetMaster" },
      { name: "description", content: "Upload your proof of payment to unlock the calculator." },
    ],
  }),
  component: PendingPage,
});

function PendingPage() {
  const { user, profile, loading, isApproved, refreshProfile, signOut } = useAuth();
  const navigate = useNavigate();
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  // Signed-out users belong on /login; already-approved users (and admins)
  // never need this step.
  useEffect(() => {
    if (loading) return;
    if (!user) navigate({ to: "/login", replace: true });
    else if (isApproved) navigate({ to: "/calculator", replace: true });
  }, [loading, user, isApproved, navigate]);

  if (loading || !user || isApproved) return <RouteSpinner />;

  const status = profile?.status;

  const upload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return;
    setBusy(true);
    setError("");
    setMsg("");

    const ext = file.name.split(".").pop();
    const path = `${user.id}/proof-${Date.now()}.${ext}`;

    const { error: upErr } = await supabase.storage
      .from("payment-proofs")
      .upload(path, file, { upsert: true });

    if (upErr) {
      setBusy(false);
      setError(`Upload failed: ${upErr.message}`);
      return;
    }

    const { error: profErr } = await supabase
      .from("profiles")
      .update({ payment_proof_url: path })
      .eq("id", user.id);

    setBusy(false);
    if (profErr) {
      setError(`Could not save proof: ${profErr.message}`);
    } else {
      setMsg("Proof uploaded. An admin will review your request shortly.");
      void refreshProfile();
    }
  };

  const rejected = status === "rejected";

  return (
    <AuthShell
      wide
      title={rejected ? "Access rejected" : "Awaiting approval"}
      subtitle={
        rejected
          ? "Your request was not approved. You can upload a new proof of payment to try again."
          : `Hi ${profile?.full_name || user.email}. To use the BetMaster calculator, upload your proof of payment. An admin will review and approve your access.`
      }
    >
      <span
        className={cn(
          "inline-flex rounded-full px-2.5 py-1 text-xs font-semibold capitalize",
          status === "approved" && "bg-success/15 text-success",
          status === "rejected" && "bg-destructive/15 text-destructive",
          status === "pending" && "bg-warning/20 text-warning-foreground",
        )}
      >
        Status: {status ?? "loading…"}
      </span>

      {profile?.payment_proof_url && (
        <p className="mt-3 text-xs text-muted-foreground">
          Current proof on file: {profile.payment_proof_url.split("/").pop()}
        </p>
      )}

      <div className="mt-4">
        {error && <Alert tone="error">{error}</Alert>}
        {msg && <Alert tone="success">{msg}</Alert>}
      </div>

      <form onSubmit={upload} className="space-y-4">
        <div>
          <label className="label" htmlFor="proof">
            Proof of payment (image or PDF)
          </label>
          <input
            id="proof"
            type="file"
            accept="image/*,application/pdf"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="input file:mr-3 file:rounded file:border-0 file:bg-secondary file:px-3 file:py-1 file:text-sm file:font-medium"
          />
        </div>

        <button
          type="submit"
          disabled={busy || !file}
          className="btn-primary w-full justify-center disabled:opacity-60"
        >
          {busy ? "Uploading…" : "Upload proof"}
        </button>
      </form>

      <div className="mt-5 flex justify-between text-sm">
        <button
          type="button"
          onClick={() => void refreshProfile()}
          className="text-primary hover:underline"
        >
          Refresh status
        </button>
        <button
          type="button"
          onClick={async () => {
            await signOut();
            navigate({ to: "/login", replace: true });
          }}
          className="text-muted-foreground hover:underline"
        >
          Sign out
        </button>
      </div>
    </AuthShell>
  );
}
