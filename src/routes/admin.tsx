import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { ShieldCheck, FileText, Check, X } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { ProtectedRoute } from "@/components/protected-route";
import { Alert } from "@/components/auth-shell";
import { supabase, type Profile, type ProfileStatus } from "@/lib/supabase";
import { formatDate } from "@/lib/format-date";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [
      { title: "User approvals — BetMaster" },
      {
        name: "description",
        content: "Review proof of payment and approve or reject calculator access.",
      },
    ],
  }),
  component: AdminRoute,
});

function AdminRoute() {
  return (
    <ProtectedRoute requireAdmin>
      <AdminPage />
    </ProtectedRoute>
  );
}

const STATUS_FILTERS = ["pending", "approved", "rejected", "all"] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

function AdminPage() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [filter, setFilter] = useState<StatusFilter>("pending");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    let query = supabase.from("profiles").select("*").order("created_at", { ascending: false });
    if (filter !== "all") query = query.eq("status", filter);
    const { data, error } = await query;
    setLoading(false);
    if (error) setError(error.message);
    else {
      setError("");
      setProfiles((data ?? []) as Profile[]);
    }
  }, [filter]);

  useEffect(() => {
    void load();
  }, [load]);

  const setStatus = async (id: string, status: ProfileStatus) => {
    setBusyId(id);
    const { error } = await supabase.from("profiles").update({ status }).eq("id", id);
    setBusyId(null);
    if (error) setError(error.message);
    // Reload so the current filter stays accurate — approving from "pending"
    // should make the row disappear.
    else await load();
  };

  /**
   * Proof files are private. Rather than exposing a permanent URL, mint a
   * short-lived signed link (60s) each time an admin asks to look.
   */
  const viewProof = async (path: string | null) => {
    if (!path) return;
    const { data, error } = await supabase.storage.from("payment-proofs").createSignedUrl(path, 60);
    if (error) {
      setError(error.message);
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener");
  };

  return (
    <AppShell>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold md:text-3xl">
            <ShieldCheck className="h-6 w-6 text-primary" />
            User approvals
          </h1>
          <p className="text-sm text-muted-foreground">
            Review proof of payment and approve or reject calculator access.
          </p>
        </div>

        <div className="inline-flex rounded-lg border border-border bg-card p-1">
          {STATUS_FILTERS.map((s) => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className={cn(
                "rounded-md px-3 py-1.5 text-xs font-medium capitalize transition",
                filter === s
                  ? "bg-primary text-primary-foreground"
                  : "text-foreground hover:bg-accent",
              )}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {error && <Alert tone="error">{error}</Alert>}

      {loading ? (
        <div className="card flex items-center gap-3 text-sm text-muted-foreground">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-border border-t-primary" />
          Loading…
        </div>
      ) : profiles.length === 0 ? (
        <div className="card text-center text-sm text-muted-foreground">
          No users in “{filter}”.
        </div>
      ) : (
        <div className="space-y-3">
          {profiles.map((p) => (
            <div key={p.id} className="card flex flex-wrap items-center justify-between gap-4">
              <div className="flex min-w-0 items-center gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
                  {(p.full_name || p.email || "?").slice(0, 1).toUpperCase()}
                </span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <strong className="truncate">{p.full_name || "(no name)"}</strong>
                    <StatusBadge status={p.status} />
                    {p.role === "admin" && (
                      <span className="rounded-full bg-primary/15 px-2 py-0.5 text-xs font-bold text-primary">
                        admin
                      </span>
                    )}
                  </div>
                  <div className="truncate text-sm text-muted-foreground">{p.email}</div>
                  {p.created_at && (
                    <div className="text-xs text-muted-foreground">
                      Registered {formatDate(p.created_at)}
                    </div>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  disabled={!p.payment_proof_url}
                  onClick={() => void viewProof(p.payment_proof_url)}
                  className="btn-secondary disabled:opacity-50"
                  title={
                    p.payment_proof_url
                      ? "Opens a link that expires after a minute"
                      : "This user hasn't uploaded a proof yet"
                  }
                >
                  <FileText className="h-4 w-4" />
                  {p.payment_proof_url ? "View proof" : "No proof"}
                </button>

                {p.status !== "approved" && (
                  <button
                    disabled={busyId === p.id}
                    onClick={() => void setStatus(p.id, "approved")}
                    className="btn-primary disabled:opacity-60"
                  >
                    <Check className="h-4 w-4" /> Approve
                  </button>
                )}

                {/* An admin can never be locked out of their own app. */}
                {p.status !== "rejected" && p.role !== "admin" && (
                  <button
                    disabled={busyId === p.id}
                    onClick={() => void setStatus(p.id, "rejected")}
                    className="btn-ghost text-destructive disabled:opacity-60"
                  >
                    <X className="h-4 w-4" /> Reject
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </AppShell>
  );
}

function StatusBadge({ status }: { status: ProfileStatus }) {
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-xs font-bold capitalize",
        status === "approved" && "bg-success/15 text-success",
        status === "rejected" && "bg-destructive/15 text-destructive",
        status === "pending" && "bg-warning/15 text-warning-foreground",
      )}
    >
      {status}
    </span>
  );
}
