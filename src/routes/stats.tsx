import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Download, ChevronRight, ChevronDown } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { ProtectedRoute } from "@/components/protected-route";
import { Alert } from "@/components/auth-shell";
import { BarChart, LineChart, DonutChart, type Point } from "@/components/charts";
import { supabase, type Bet } from "@/lib/supabase";
import {
  computeBet,
  fmt,
  PERIODS,
  withinPeriod,
  aggregateByTeam,
  betTeamNames,
  downloadCSV,
  type ComputedBet,
} from "@/lib/bet-stats";
import { formatDate } from "@/lib/format-date";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/stats")({
  head: () => ({
    meta: [
      { title: "Stats — BetMaster" },
      {
        name: "description",
        content: "Profit, ROI and win rate across your settled bets, with a per-team breakdown.",
      },
      { property: "og:title", content: "Stats — BetMaster" },
      { property: "og:description", content: "Performance dashboard built from your saved bets." },
    ],
  }),
  component: StatsRoute,
});

function StatsRoute() {
  return (
    <ProtectedRoute>
      <StatsPage />
    </ProtectedRoute>
  );
}

/** Day bucket key, in UTC so server and client agree. */
const dayKey = (d: string) => new Date(d).toISOString().slice(0, 10);
const shortDay = (key: string) => {
  const [, m, day] = key.split("-");
  return `${parseInt(m, 10)}/${parseInt(day, 10)}`;
};

const resultLabel = (c: ComputedBet) => {
  if (!c.settled) return "Pending";
  if (c.lost || c.netProfit < 0) return "Lost";
  if (c.netProfit > 0) return "Won";
  return "Break-even";
};

function StatsPage() {
  const [bets, setBets] = useState<Bet[]>([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<string>("30d");
  const [error, setError] = useState("");
  const [showHelp, setShowHelp] = useState(false);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("bets")
        .select("*")
        .order("created_at", { ascending: true });
      if (error) setError(error.message);
      else setBets((data ?? []) as Bet[]);
      setLoading(false);
    };
    void load();
  }, []);

  const periodDays = PERIODS.find((p) => p.key === period)?.days ?? null;

  const stats = useMemo(() => {
    const inPeriod = bets.filter((b) => withinPeriod(b.created_at, periodDays));
    const computed = inPeriod.map((b) => ({ bet: b, ...computeBet(b) }));

    let totalStaked = 0;
    let settledStaked = 0;
    let pendingStaked = 0;
    let totalReturns = 0;
    let netProfit = 0;
    let settledCount = 0;
    let wins = 0;
    let losses = 0;

    computed.forEach((c) => {
      totalStaked += c.totalStaked;
      if (c.settled) {
        settledCount += 1;
        settledStaked += c.totalStaked;
        totalReturns += c.returnAmount;
        netProfit += c.netProfit;
        if (c.netProfit > 0) wins += 1;
        else losses += 1;
      } else {
        pendingStaked += c.totalStaked;
      }
    });

    // Staked per day — includes pending, because it measures activity.
    const byDay: Record<string, number> = {};
    computed.forEach((c) => {
      const k = dayKey(c.bet.created_at);
      byDay[k] = (byDay[k] || 0) + c.totalStaked;
    });
    const stakeSeries: Point[] = Object.keys(byDay)
      .sort()
      .map((k) => ({ label: k, short: shortDay(k), value: byDay[k] }));

    // Net profit per day — settled only.
    const profitByDay: Record<string, number> = {};
    computed
      .filter((c) => c.settled)
      .forEach((c) => {
        const k = dayKey(c.bet.created_at);
        profitByDay[k] = (profitByDay[k] || 0) + c.netProfit;
      });
    const profitBarSeries: Point[] = Object.keys(profitByDay)
      .sort()
      .map((k) => ({ label: k, short: shortDay(k), value: profitByDay[k] }));

    // Cumulative net profit — the equity curve.
    let running = 0;
    const profitSeries: Point[] = computed
      .filter((c) => c.settled)
      .map((c) => {
        running += c.netProfit;
        return {
          label: formatDate(c.bet.created_at),
          short: shortDay(dayKey(c.bet.created_at)),
          value: running,
        };
      });

    // Pending stakes are excluded so undecided money doesn't dilute the ratio.
    const roi = settledStaked > 0 ? (netProfit / settledStaked) * 100 : 0;
    const teamStats = aggregateByTeam(computed);

    const ledger = [...computed]
      .sort((a, b) => +new Date(b.bet.created_at) - +new Date(a.bet.created_at))
      .map((c) => ({
        id: c.bet.id,
        date: c.bet.created_at,
        title: c.bet.title || "(untitled)",
        teams: betTeamNames(c.bet).join(", "),
        invested: c.totalStaked,
        returned: c.settled ? c.returnAmount : null,
        net: c.settled ? c.netProfit : null,
        result: resultLabel(c),
        winner: c.lost ? "—" : (c.wonRow?.name ?? ""),
      }));

    return {
      betsCount: inPeriod.length,
      totalStaked,
      settledCount,
      pendingCount: inPeriod.length - settledCount,
      pendingStaked,
      totalReturns,
      netProfit,
      roi,
      wins,
      losses,
      stakeSeries,
      profitSeries,
      profitBarSeries,
      teamStats,
      ledger,
    };
  }, [bets, periodDays]);

  const exportLedgerCSV = () => {
    const header = ["Date", "Bet", "Teams", "Invested", "Returned", "Net", "Result", "Winner"];
    const rows = stats.ledger.map((l) => [
      formatDate(l.date),
      l.title,
      l.teams,
      l.invested.toFixed(2),
      l.returned == null ? "" : l.returned.toFixed(2),
      l.net == null ? "" : l.net.toFixed(2),
      l.result,
      l.winner,
    ]);
    downloadCSV(`betmaster-ledger-${period}.csv`, [header, ...rows]);
  };

  return (
    <AppShell>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold md:text-3xl">Stats</h1>
          <p className="text-sm text-muted-foreground">
            Generated from your saved bets. Mark winners under “My Bets” to settle them.
          </p>
        </div>
        <div className="inline-flex rounded-lg border border-border bg-card p-1">
          {PERIODS.map((p) => (
            <button
              key={p.key}
              onClick={() => setPeriod(p.key)}
              className={cn(
                "rounded-md px-3 py-1.5 text-xs font-medium transition",
                period === p.key
                  ? "bg-primary text-primary-foreground"
                  : "text-foreground hover:bg-accent",
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* How to record stats */}
      <div className="mb-4">
        <button
          onClick={() => setShowHelp((v) => !v)}
          aria-expanded={showHelp}
          className="flex items-center gap-1 text-sm font-medium text-primary hover:underline"
        >
          {showHelp ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          How to record stats
        </button>
        {showHelp && (
          <div className="card mt-2 text-sm">
            <p className="text-muted-foreground">
              These reports are built automatically from your saved bets. To make them accurate,
              follow this workflow:
            </p>
            <ol className="mt-3 list-decimal space-y-1.5 pl-5">
              <li>
                <strong>Build a bet in the Calculator.</strong> Enter team names, stakes and odds
                for each scenario, or use the balancing buttons for suggested stakes.
              </li>
              <li>
                <strong>Save the bet.</strong> It appears under <em>My Bets</em> as Pending — its
                stake counts as invested and as pending exposure here.
              </li>
              <li>
                <strong>Settle it when the games finish.</strong> On <em>My Bets</em>, pick the
                winning scenario and click <em>Mark winner</em>, or <em>Mark lost</em> if none won.
              </li>
              <li>
                <strong>Read your stats.</strong> Returns, net profit, ROI, win rate and the
                per-team table update instantly.
              </li>
            </ol>
            <p className="mt-3 text-xs text-muted-foreground">
              <strong>Notes:</strong> “Returns” and “Net profit” count <em>settled</em> bets only.
              Net profit already accounts for the tax rate saved with each bet. Use <em>Reset</em>{" "}
              on a bet to move it back to pending. Per-team figures attribute a bet to every team it
              involves, so those columns sum to more than the account totals.
            </p>
          </div>
        )}
      </div>

      {error && <Alert tone="error">{error}</Alert>}

      {loading ? (
        <div className="card flex items-center gap-3 text-sm text-muted-foreground">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-border border-t-primary" />
          Loading…
        </div>
      ) : stats.betsCount === 0 ? (
        <div className="card text-center text-sm text-muted-foreground">
          No bets in this period.
        </div>
      ) : (
        <>
          {/* KPIs */}
          <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
            <Kpi label="Total bets" value={String(stats.betsCount)} />
            <Kpi label="Total staked" value={fmt(stats.totalStaked)} />
            <Kpi label="Returns (settled)" value={fmt(stats.totalReturns)} />
            <Kpi
              label="Net profit (settled)"
              value={`${stats.netProfit >= 0 ? "+" : ""}${fmt(stats.netProfit)}`}
              tone={stats.netProfit >= 0 ? "success" : "danger"}
            />
            <Kpi
              label="ROI (settled)"
              value={`${stats.roi >= 0 ? "+" : ""}${stats.roi.toFixed(1)}%`}
              tone={stats.roi >= 0 ? "success" : "danger"}
            />
            <Kpi label="Pending exposure" value={fmt(stats.pendingStaked)} />
            <Kpi
              label="W / L / Pending"
              value={`${stats.wins} / ${stats.losses} / ${stats.pendingCount}`}
            />
          </div>

          {/* Charts */}
          <div className="mb-4 grid gap-3 lg:grid-cols-2">
            <div className="card">
              <h2 className="mb-2 text-sm font-semibold">Amount staked per day</h2>
              <BarChart data={stats.stakeSeries} />
            </div>
            <div className="card">
              <h2 className="mb-2 text-sm font-semibold">Net profit per day</h2>
              <BarChart data={stats.profitBarSeries} polarity />
            </div>
            <div className="card">
              <h2 className="mb-2 text-sm font-semibold">Cumulative net profit</h2>
              <LineChart data={stats.profitSeries} />
            </div>
            <div className="card">
              <h2 className="mb-2 text-sm font-semibold">Win rate</h2>
              <div className="flex flex-wrap items-center justify-center gap-6 py-2">
                <DonutChart wins={stats.wins} losses={stats.losses} />
                {/* Legend: identity is never colour-alone. */}
                <ul className="space-y-2 text-sm">
                  <li className="flex items-center gap-2">
                    <span
                      aria-hidden
                      className="h-3 w-3 rounded-sm"
                      style={{ background: "var(--chart-pos)" }}
                    />
                    <span className="font-semibold">{stats.wins}</span> won
                  </li>
                  <li className="flex items-center gap-2">
                    <span
                      aria-hidden
                      className="h-3 w-3 rounded-sm"
                      style={{
                        background:
                          "repeating-linear-gradient(45deg, var(--chart-neg) 0 2px, var(--color-card) 2px 3.5px)",
                      }}
                    />
                    <span className="font-semibold">{stats.losses}</span> lost
                  </li>
                </ul>
              </div>
            </div>
          </div>

          {/* Per-team */}
          <div className="card mb-4 overflow-hidden p-0">
            <h2 className="border-b border-border px-4 py-3 text-sm font-semibold">
              Performance by team
            </h2>
            {stats.teamStats.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">
                Add team names in the Calculator to see per-team performance.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-secondary text-xs uppercase tracking-wide text-secondary-foreground">
                    <tr>
                      <th className="p-3 text-left">Team</th>
                      <th className="p-3 text-right">Bets</th>
                      <th className="p-3 text-right">Staked</th>
                      <th className="p-3 text-right">Net</th>
                      <th className="p-3 text-right">ROI</th>
                      <th className="p-3 text-right">Win rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.teamStats.map((t) => (
                      <tr key={t.team} className="border-t border-border">
                        <td className="p-3">{t.team}</td>
                        <td className="p-3 text-right">{t.bets}</td>
                        <td className="p-3 text-right font-mono">{fmt(t.staked)}</td>
                        <td
                          className={cn(
                            "p-3 text-right font-mono font-semibold",
                            t.netProfit >= 0 ? "text-success" : "text-destructive",
                          )}
                        >
                          {t.netProfit >= 0 ? "+" : ""}
                          {fmt(t.netProfit)}
                        </td>
                        <td
                          className={cn(
                            "p-3 text-right font-mono",
                            t.roi >= 0 ? "text-success" : "text-destructive",
                          )}
                        >
                          {t.settled ? `${t.roi >= 0 ? "+" : ""}${t.roi.toFixed(1)}%` : "—"}
                        </td>
                        <td className="p-3 text-right font-mono">
                          {t.settled ? `${t.winRate.toFixed(0)}%` : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Ledger */}
          <div className="card overflow-hidden p-0">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <h2 className="text-sm font-semibold">Bet ledger</h2>
              <button onClick={exportLedgerCSV} className="btn-secondary py-1.5 text-xs">
                <Download className="h-3.5 w-3.5" /> Export CSV
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-secondary text-xs uppercase tracking-wide text-secondary-foreground">
                  <tr>
                    <th className="p-3 text-left">Date</th>
                    <th className="p-3 text-left">Bet</th>
                    <th className="p-3 text-left">Teams</th>
                    <th className="p-3 text-right">Invested</th>
                    <th className="p-3 text-right">Returned</th>
                    <th className="p-3 text-right">Net</th>
                    <th className="p-3 text-left">Result</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.ledger.map((l) => (
                    <tr key={l.id} className="border-t border-border">
                      <td className="whitespace-nowrap p-3">{formatDate(l.date)}</td>
                      <td className="max-w-56 truncate p-3" title={l.title}>
                        {l.title}
                      </td>
                      <td className="p-3">{l.teams || "—"}</td>
                      <td className="p-3 text-right font-mono">{fmt(l.invested)}</td>
                      <td className="p-3 text-right font-mono">
                        {l.returned == null ? "—" : fmt(l.returned)}
                      </td>
                      <td
                        className={cn(
                          "p-3 text-right font-mono font-semibold",
                          l.net == null ? "" : l.net >= 0 ? "text-success" : "text-destructive",
                        )}
                      >
                        {l.net == null ? "—" : `${l.net >= 0 ? "+" : ""}${fmt(l.net)}`}
                      </td>
                      <td className="p-3">
                        <span
                          className={cn(
                            "rounded-full px-2 py-0.5 text-xs font-bold",
                            l.result === "Won" && "bg-success/15 text-success",
                            l.result === "Lost" && "bg-destructive/15 text-destructive",
                            l.result === "Pending" && "bg-warning/15 text-warning-foreground",
                            l.result === "Break-even" && "bg-secondary text-secondary-foreground",
                          )}
                        >
                          {l.result}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </AppShell>
  );
}

function Kpi({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "success" | "danger";
}) {
  return (
    <div className="card">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div
        className={cn(
          "mt-1 text-lg font-bold",
          tone === "success" && "text-success",
          tone === "danger" && "text-destructive",
        )}
      >
        {value}
      </div>
    </div>
  );
}
