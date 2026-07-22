import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  CheckCircle2,
  XCircle,
  Clock,
  ExternalLink,
  Trash2,
  RotateCcw,
  Trophy,
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { ProtectedRoute } from "@/components/protected-route";
import { Alert } from "@/components/auth-shell";
import { supabase, type Bet, type BetRow } from "@/lib/supabase";
import { computeBet, fmt, toNumber, labelScenario, betTeamNames, LOST } from "@/lib/bet-stats";
import { formatDateTime } from "@/lib/format-date";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/my-bets")({
  head: () => ({
    meta: [
      { title: "My Bets — BetMaster" },
      {
        name: "description",
        content:
          "Every plan you saved, from pending to settled. Track winners, losses and net profit.",
      },
      { property: "og:title", content: "My Bets — BetMaster" },
      { property: "og:description", content: "Bet history, settlement and results." },
    ],
  }),
  component: MyBetsRoute,
});

function MyBetsRoute() {
  return (
    <ProtectedRoute>
      <MyBetsPage />
    </ProtectedRoute>
  );
}

type StatusFilter = "all" | "pending" | "won" | "lost";

/** Pending settlement being confirmed — an editable copy of the bet's rows. */
interface Settling {
  betId: string;
  scenario: string;
  rows: BetRow[];
}

function MyBetsPage() {
  const navigate = useNavigate();
  const [bets, setBets] = useState<Bet[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusMsg, setStatusMsg] = useState("");
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [settling, setSettling] = useState<Settling | null>(null);

  const loadBets = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("bets")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) setStatusMsg(`Could not load bets: ${error.message}`);
    else setBets((data ?? []) as Bet[]);
    setLoading(false);
  };

  useEffect(() => {
    void loadBets();
  }, []);

  /** Hand the bet to the Calculator via router state. */
  const openBet = (bet: Bet) => navigate({ to: "/calculator", state: { loadBet: bet } as never });

  const deleteBet = async (id: string) => {
    const { error } = await supabase.from("bets").delete().eq("id", id);
    if (error) setStatusMsg(`Delete failed: ${error.message}`);
    else setBets((prev) => prev.filter((b) => b.id !== id));
  };

  /**
   * Open the confirm panel with editable copies of the saved stakes/odds, so
   * the user can correct them to what was actually wagered before settling.
   */
  const beginSettle = (bet: Bet, scenario: string) => {
    setSettling({
      betId: bet.id,
      scenario,
      rows: (bet.rows ?? []).map((r) => ({ ...r })),
    });
  };

  const updateSettleRow = (index: number, field: "stake" | "odds", value: string) => {
    setSettling((s) =>
      s ? { ...s, rows: s.rows.map((r, i) => (i === index ? { ...r, [field]: value } : r)) } : s,
    );
  };

  const settleBet = async (bet: Bet, scenario: string, rows?: BetRow[]) => {
    const won = scenario || null;
    const update: Record<string, unknown> = {
      won_scenario: won,
      settled_at: won ? new Date().toISOString() : null,
    };
    if (rows) update.rows = rows;

    const { error } = await supabase.from("bets").update(update).eq("id", bet.id);
    if (error) {
      setStatusMsg(`Could not settle: ${error.message}`);
      return;
    }
    setBets((prev) =>
      prev.map((b) =>
        b.id === bet.id ? { ...b, won_scenario: won, ...(rows ? { rows } : {}) } : b,
      ),
    );
    setPicks((p) => ({ ...p, [bet.id]: won && won !== LOST ? won : "" }));
    setSettling(null);
    setStatusMsg(
      won === LOST
        ? `Marked "${bet.title}" as lost.`
        : won
          ? `Marked winner for "${bet.title}".`
          : `Reset "${bet.title}".`,
    );
  };

  // Status is derived, not stored: a bet with a winning scenario can still be
  // a net loss, and the badge reflects the net result.
  const statusOf = (bet: Bet): "pending" | "won" | "lost" => {
    const c = computeBet(bet);
    if (!c.settled) return "pending";
    return c.lost || c.netProfit < 0 ? "lost" : "won";
  };

  const visible = bets.filter((b) => filter === "all" || statusOf(b) === filter);

  const counts = {
    all: bets.length,
    pending: bets.filter((b) => statusOf(b) === "pending").length,
    won: bets.filter((b) => statusOf(b) === "won").length,
    lost: bets.filter((b) => statusOf(b) === "lost").length,
  };

  return (
    <AppShell>
      <div className="mb-6">
        <h1 className="text-2xl font-bold md:text-3xl">My Bets</h1>
        <p className="text-sm text-muted-foreground">
          Your previously saved bets, most recent first.
        </p>
      </div>

      {statusMsg && <Alert tone="info">{statusMsg}</Alert>}

      <div className="mb-4 flex flex-wrap gap-2">
        {(["all", "pending", "won", "lost"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={cn(
              "rounded-full border px-3 py-1.5 text-xs font-medium capitalize transition",
              filter === f
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-card text-foreground hover:bg-accent",
            )}
          >
            {f === "all" ? "All bets" : f} ({counts[f]})
          </button>
        ))}
      </div>

      {loading ? (
        <div className="card flex items-center gap-3 text-sm text-muted-foreground">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-border border-t-primary" />
          Loading…
        </div>
      ) : bets.length === 0 ? (
        <div className="card text-center text-sm text-muted-foreground">
          No saved bets yet. Save one from the Calculator.
        </div>
      ) : visible.length === 0 ? (
        <div className="card text-center text-sm text-muted-foreground">
          No {filter} bets. Change the filter to see the rest.
        </div>
      ) : (
        <div className="space-y-3">
          {visible.map((bet) => {
            const c = computeBet(bet);
            const status = statusOf(bet);
            const teams = betTeamNames(bet);
            const pick = picks[bet.id] ?? bet.won_scenario ?? "";
            const StatusIcon =
              status === "won" ? CheckCircle2 : status === "lost" ? XCircle : Clock;

            return (
              <article key={bet.id} className="card">
                {/* Headline */}
                <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
                  <div className="min-w-0">
                    <div className="mb-1 flex flex-wrap items-center gap-2">
                      <span
                        className={cn(
                          "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold capitalize",
                          status === "won" && "bg-success/15 text-success",
                          status === "lost" && "bg-destructive/15 text-destructive",
                          status === "pending" && "bg-warning/15 text-warning-foreground",
                        )}
                      >
                        <StatusIcon className="h-3 w-3" /> {status}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {formatDateTime(bet.created_at)}
                      </span>
                    </div>
                    <h3 className="truncate text-base font-semibold">{bet.title}</h3>
                    <p className="mt-0.5 text-sm text-muted-foreground">
                      {teams.length > 0 ? `${teams.join(" · ")} — ` : ""}
                      {bet.team_count} event{bet.team_count > 1 ? "s" : ""} · tax{" "}
                      {toNumber(bet.tax)}
                    </p>
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-muted-foreground">Staked</div>
                    <div className="text-lg font-bold">{fmt(c.totalStaked)}</div>
                  </div>
                </div>

                {/* Settled figures */}
                {c.settled && (
                  <div className="mt-3 grid grid-cols-2 gap-3 border-t border-border pt-3 sm:grid-cols-4">
                    <MiniStat
                      label="Winner"
                      value={
                        c.lost ? "None (lost)" : c.wonRow ? labelScenario(bet, c.wonRow.name) : "—"
                      }
                      icon={!c.lost && c.wonRow ? Trophy : undefined}
                    />
                    <MiniStat label="Returned" value={fmt(c.returnAmount)} />
                    <MiniStat
                      label="Net"
                      value={`${c.netProfit >= 0 ? "+" : ""}${fmt(c.netProfit)}`}
                      tone={c.netProfit >= 0 ? "success" : "danger"}
                    />
                    <MiniStat label="Total staked" value={fmt(c.totalStaked)} />
                  </div>
                )}

                {/* Settlement controls */}
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <select
                    value={pick}
                    onChange={(e) => setPicks((p) => ({ ...p, [bet.id]: e.target.value }))}
                    className="input w-auto min-w-48 max-w-full"
                    aria-label="Winning scenario"
                  >
                    <option value="">Winning scenario…</option>
                    {(bet.rows ?? []).map((r) => (
                      <option key={r.name} value={r.name}>
                        {labelScenario(bet, r.name)}
                      </option>
                    ))}
                  </select>
                  <button
                    disabled={!pick}
                    onClick={() => beginSettle(bet, pick)}
                    className="btn-primary disabled:opacity-50"
                  >
                    Mark winner
                  </button>
                  <button onClick={() => beginSettle(bet, LOST)} className="btn-secondary">
                    Mark lost
                  </button>

                  <span className="mx-1 hidden h-5 w-px bg-border sm:block" />

                  <button onClick={() => openBet(bet)} className="btn-secondary">
                    <ExternalLink className="h-4 w-4" /> Open
                  </button>
                  {c.settled && (
                    <button onClick={() => void settleBet(bet, "")} className="btn-secondary">
                      <RotateCcw className="h-4 w-4" /> Reset
                    </button>
                  )}
                  <button
                    onClick={() => void deleteBet(bet.id)}
                    className="btn-ghost ml-auto text-destructive"
                  >
                    <Trash2 className="h-4 w-4" /> Delete
                  </button>
                </div>

                {/* Confirm panel */}
                {settling && settling.betId === bet.id && (
                  <SettleConfirm
                    bet={bet}
                    settling={settling}
                    onPickWinner={(name) => setSettling((s) => (s ? { ...s, scenario: name } : s))}
                    onUpdateRow={updateSettleRow}
                    onConfirm={() => void settleBet(bet, settling.scenario, settling.rows)}
                    onCancel={() => setSettling(null)}
                  />
                )}
              </article>
            );
          })}
        </div>
      )}
    </AppShell>
  );
}

function SettleConfirm({
  bet,
  settling,
  onPickWinner,
  onUpdateRow,
  onConfirm,
  onCancel,
}: {
  bet: Bet;
  settling: Settling;
  onPickWinner: (name: string) => void;
  onUpdateRow: (index: number, field: "stake" | "odds", value: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const isLoss = settling.scenario === LOST;
  // Live preview using the edited rows, so the figures update as you type.
  const preview = computeBet({
    rows: settling.rows,
    tax: bet.tax,
    won_scenario: settling.scenario,
  });

  return (
    <div className="mt-4 rounded-lg border border-primary/30 bg-primary/5 p-4">
      <p className="text-sm font-semibold">
        {isLoss
          ? "Confirm loss — adjust stakes to what was actually wagered:"
          : `Confirm win for "${labelScenario(bet, settling.scenario)}" — adjust stakes/odds to what was actually wagered:`}
      </p>
      {!isLoss && (
        <p className="mt-1 text-xs text-muted-foreground">
          Click a scenario below to change which one won.
        </p>
      )}

      <div className="mt-3 max-h-72 space-y-1 overflow-y-auto pr-1">
        {settling.rows.map((r, i) => {
          const isWinner = !isLoss && r.name === settling.scenario;
          return (
            <div
              key={r.name}
              onClick={() => !isLoss && onPickWinner(r.name)}
              title={isLoss ? undefined : "Mark this scenario as the winner"}
              className={cn(
                "grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 rounded-md border px-2 py-1.5",
                isWinner ? "border-success/50 bg-success/10" : "border-transparent",
                !isLoss && "cursor-pointer hover:bg-accent",
              )}
            >
              <span className="flex min-w-0 items-center gap-2">
                {!isLoss && (
                  <input
                    type="radio"
                    name={`winner-${bet.id}`}
                    checked={isWinner}
                    onChange={() => onPickWinner(r.name)}
                    onClick={(e) => e.stopPropagation()}
                    className="h-3.5 w-3.5 shrink-0 accent-primary"
                  />
                )}
                <span className="truncate text-sm">{labelScenario(bet, r.name)}</span>
                {isWinner && (
                  <span className="shrink-0 rounded-full bg-success px-1.5 py-0.5 text-[10px] font-bold text-success-foreground">
                    Winner
                  </span>
                )}
              </span>
              <label onClick={(e) => e.stopPropagation()} className="flex items-center gap-1">
                <span className="text-[10px] uppercase text-muted-foreground">Stake</span>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={r.stake}
                  onChange={(e) => onUpdateRow(i, "stake", e.target.value)}
                  className="input w-20 text-right"
                />
              </label>
              <label onClick={(e) => e.stopPropagation()} className="flex items-center gap-1">
                <span className="text-[10px] uppercase text-muted-foreground">Odds</span>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={r.odds}
                  disabled={isLoss}
                  onChange={(e) => onUpdateRow(i, "odds", e.target.value)}
                  className="input w-20 text-right disabled:opacity-50"
                />
              </label>
            </div>
          );
        })}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-4 border-t border-border pt-3 text-sm">
        <span>
          Total staked <strong>{fmt(preview.totalStaked)}</strong>
        </span>
        {!isLoss && (
          <span>
            Return <strong>{fmt(preview.returnAmount)}</strong>
          </span>
        )}
        <span className={preview.netProfit >= 0 ? "text-success" : "text-destructive"}>
          Net <strong>{fmt(preview.netProfit)}</strong>
        </span>
      </div>

      <div className="mt-3 flex gap-2">
        <button
          onClick={onConfirm}
          className={cn(
            "btn-primary",
            isLoss && "bg-destructive shadow-none hover:bg-destructive/90",
          )}
        >
          {isLoss ? "Confirm loss" : "Confirm win"}
        </button>
        <button onClick={onCancel} className="btn-secondary">
          Cancel
        </button>
      </div>
    </div>
  );
}

function MiniStat({
  label,
  value,
  tone = "default",
  icon: Icon,
}: {
  label: string;
  value: string;
  tone?: "default" | "success" | "danger";
  icon?: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="min-w-0">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className={cn(
          "flex items-center gap-1 truncate text-sm font-semibold",
          tone === "success" && "text-success",
          tone === "danger" && "text-destructive",
        )}
        title={value}
      >
        {Icon && <Icon className="h-3.5 w-3.5 shrink-0" />}
        <span className="truncate">{value}</span>
      </div>
    </div>
  );
}
