import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AppShell } from "@/components/app-shell";
import { sampleBets, fmt } from "@/lib/betmaster-data";
import { CheckCircle2, XCircle, Clock, ExternalLink, Trash2, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/my-bets")({
  head: () => ({
    meta: [
      { title: "My Bets — BetMaster" },
      { name: "description", content: "Every plan you saved, from pending to settled. Track winners, losses and net profit." },
      { property: "og:title", content: "My Bets — BetMaster" },
      { property: "og:description", content: "Bet history, settlement and results." },
    ],
  }),
  component: MyBetsPage,
});

function MyBetsPage() {
  const [filter, setFilter] = useState<"all" | "Pending" | "Won" | "Lost">("all");
  const filtered = sampleBets.filter((b) => filter === "all" || b.status === filter);

  return (
    <AppShell>
      <div className="mb-6">
        <h1 className="text-2xl font-bold md:text-3xl">My Bets</h1>
        <p className="text-sm text-muted-foreground">Everything you've saved, most recent first.</p>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {(["all", "Pending", "Won", "Lost"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={cn(
              "rounded-full border px-3 py-1.5 text-xs font-medium capitalize",
              filter === f
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-card text-foreground hover:bg-accent"
            )}
          >
            {f === "all" ? "All bets" : f}
          </button>
        ))}
      </div>

      <div className="space-y-3">
        {filtered.map((b) => {
          const StatusIcon = b.status === "Won" ? CheckCircle2 : b.status === "Lost" ? XCircle : Clock;
          return (
            <div key={b.id} className="card">
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 sm:flex sm:justify-between">
                <div className="min-w-0">
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    <span className={cn(
                      "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold",
                      b.status === "Won" && "bg-success/15 text-success",
                      b.status === "Lost" && "bg-destructive/15 text-destructive",
                      b.status === "Pending" && "bg-warning/15 text-warning-foreground",
                    )}>
                      <StatusIcon className="h-3 w-3" /> {b.status}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {new Date(b.savedAt).toLocaleString()}
                    </span>
                  </div>
                  <h3 className="truncate text-base font-semibold">{b.title}</h3>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    {b.sport} · {b.events} event{b.events > 1 ? "s" : ""} · {b.participants.join(", ")}
                  </p>
                </div>
                <div className="text-right">
                  <div className="text-xs text-muted-foreground">Staked</div>
                  <div className="text-lg font-bold">${fmt(b.totalStake)}</div>
                </div>
              </div>

              {b.status !== "Pending" && (
                <div className="mt-3 grid grid-cols-2 gap-3 border-t border-border pt-3 sm:grid-cols-4">
                  <MiniStat label="Winner" value={b.winner ?? "None (lost)"} />
                  <MiniStat label="Returned" value={`$${fmt(b.returned ?? 0)}`} />
                  <MiniStat
                    label="Net"
                    value={`${(b.netProfit ?? 0) >= 0 ? "+" : ""}$${fmt(b.netProfit ?? 0)}`}
                    tone={(b.netProfit ?? 0) >= 0 ? "success" : "danger"}
                  />
                  <MiniStat label="Tax" value={`${(b.taxRate * 100).toFixed(0)}%`} />
                </div>
              )}

              <div className="mt-3 flex flex-wrap gap-2">
                <button className="btn-secondary"><ExternalLink className="h-4 w-4" /> Open</button>
                {b.status === "Pending" ? (
                  <>
                    <button className="btn-primary">Mark winner</button>
                    <button className="btn-secondary">Mark lost</button>
                  </>
                ) : (
                  <button className="btn-secondary"><RotateCcw className="h-4 w-4" /> Reset</button>
                )}
                <button className="btn-ghost ml-auto text-destructive"><Trash2 className="h-4 w-4" /> Delete</button>
              </div>
            </div>
          );
        })}
      </div>

      {filtered.length === 0 && (
        <div className="card mt-6 text-center text-sm text-muted-foreground">
          No bets in this filter. Save one from the Calculator to see it here.
        </div>
      )}
    </AppShell>
  );
}

function MiniStat({ label, value, tone = "default" }: { label: string; value: string; tone?: "default" | "success" | "danger" }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn(
        "truncate text-sm font-semibold",
        tone === "success" && "text-success",
        tone === "danger" && "text-destructive",
      )}>{value}</div>
    </div>
  );
}
