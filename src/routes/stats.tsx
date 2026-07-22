import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { AppShell } from "@/components/app-shell";
import { getStats, fmt, sampleBets } from "@/lib/betmaster-data";
import { TrendingUp, TrendingDown, DollarSign, Percent, Download, Activity } from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/stats")({
  head: () => ({
    meta: [
      { title: "Stats — BetMaster" },
      { name: "description", content: "Profit, ROI, win rate and per-team performance derived from your saved bets." },
      { property: "og:title", content: "Stats — BetMaster" },
      { property: "og:description", content: "Your betting performance dashboard." },
    ],
  }),
  component: StatsPage,
});

const PERIODS = [
  { key: 7, label: "7 days" },
  { key: 30, label: "30 days" },
  { key: 90, label: "90 days" },
  { key: 999, label: "All time" },
] as const;

function StatsPage() {
  const [period, setPeriod] = useState<7 | 30 | 90 | 999>(30);
  const s = useMemo(() => getStats(period), [period]);

  // per-team
  const teamStats = useMemo(() => {
    const map = new Map<string, { bets: number; staked: number; net: number; wins: number; settled: number }>();
    sampleBets.forEach((b) => {
      b.participants.forEach((t) => {
        const cur = map.get(t) ?? { bets: 0, staked: 0, net: 0, wins: 0, settled: 0 };
        cur.bets++;
        cur.staked += b.totalStake;
        if (b.status !== "Pending") {
          cur.settled++;
          cur.net += b.netProfit ?? 0;
          if ((b.netProfit ?? 0) > 0) cur.wins++;
        }
        map.set(t, cur);
      });
    });
    return Array.from(map.entries())
      .map(([team, v]) => ({ team, ...v, roi: v.staked ? (v.net / v.staked) * 100 : 0, winRate: v.settled ? (v.wins / v.settled) * 100 : null }))
      .sort((a, b) => b.net - a.net);
  }, []);

  // daily chart data
  const dailyStake = useMemo(() => {
    const map = new Map<string, number>();
    s.bets.forEach((b) => {
      const d = new Date(b.savedAt).toISOString().slice(5, 10);
      map.set(d, (map.get(d) ?? 0) + b.totalStake);
    });
    return Array.from(map.entries()).sort();
  }, [s.bets]);

  const maxStake = Math.max(1, ...dailyStake.map(([, v]) => v));

  return (
    <AppShell>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold md:text-3xl">Stats</h1>
          <p className="text-sm text-muted-foreground">Performance across your saved bets.</p>
        </div>
        <button className="btn-secondary"><Download className="h-4 w-4" /> Export CSV</button>
      </div>

      {/* Period tabs */}
      <div className="mb-6 inline-flex rounded-lg border border-border bg-card p-1">
        {PERIODS.map((p) => (
          <button
            key={p.key}
            onClick={() => setPeriod(p.key)}
            className={cn(
              "rounded-md px-4 py-2 text-sm font-medium",
              period === p.key ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-accent"
            )}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Headline */}
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric icon={Activity} label="Total bets" value={String(s.total)} />
        <Metric icon={DollarSign} label="Total staked" value={`$${fmt(s.totalStaked)}`} />
        <Metric
          icon={s.netProfit >= 0 ? TrendingUp : TrendingDown}
          label="Net profit"
          value={`${s.netProfit >= 0 ? "+" : ""}$${fmt(s.netProfit)}`}
          tone={s.netProfit >= 0 ? "success" : "danger"}
        />
        <Metric icon={Percent} label="ROI (settled)" value={`${fmt(s.roi)}%`} tone={s.roi >= 0 ? "success" : "danger"} />
        <Metric icon={DollarSign} label="Returns (settled)" value={`$${fmt(s.returns)}`} />
        <Metric icon={DollarSign} label="Pending exposure" value={`$${fmt(s.pendingExposure)}`} />
        <Metric icon={TrendingUp} label="Wins / Losses" value={`${s.wins} / ${s.losses}`} />
        <Metric icon={Activity} label="Pending" value={String(s.pending)} />
      </div>

      {/* Charts */}
      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <div className="card">
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Amount staked per day</h3>
          <div className="flex h-40 items-end gap-2">
            {dailyStake.length === 0 ? (
              <div className="w-full self-center text-center text-sm text-muted-foreground">No activity in this period.</div>
            ) : dailyStake.map(([d, v]) => (
              <div key={d} className="flex flex-1 flex-col items-center gap-1">
                <div className="flex w-full flex-1 items-end">
                  <div
                    className="w-full rounded-t bg-primary transition-all"
                    style={{ height: `${(v / maxStake) * 100}%` }}
                    title={`$${fmt(v)}`}
                  />
                </div>
                <div className="text-[10px] text-muted-foreground">{d}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Win rate</h3>
          <div className="flex items-center gap-6">
            <DoughnutMock wins={s.wins} losses={s.losses} />
            <div className="space-y-2 text-sm">
              <div className="flex items-center gap-2">
                <span className="h-3 w-3 rounded-full bg-success" /> Won: <span className="font-semibold">{s.wins}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="h-3 w-3 rounded-full bg-destructive" /> Lost: <span className="font-semibold">{s.losses}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="h-3 w-3 rounded-full bg-warning" /> Pending: <span className="font-semibold">{s.pending}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Per team */}
      <div className="card mb-6 overflow-hidden p-0">
        <h3 className="border-b border-border p-4 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Performance by team
        </h3>
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
              {teamStats.map((t) => (
                <tr key={t.team} className="border-t border-border">
                  <td className="p-3 font-medium">{t.team}</td>
                  <td className="p-3 text-right font-mono">{t.bets}</td>
                  <td className="p-3 text-right font-mono">${fmt(t.staked)}</td>
                  <td className={cn("p-3 text-right font-mono font-semibold", t.net >= 0 ? "text-success" : "text-destructive")}>
                    {t.net >= 0 ? "+" : ""}${fmt(t.net)}
                  </td>
                  <td className={cn("p-3 text-right font-mono", t.settled ? (t.roi >= 0 ? "text-success" : "text-destructive") : "text-muted-foreground")}>
                    {t.settled ? `${fmt(t.roi)}%` : "—"}
                  </td>
                  <td className="p-3 text-right font-mono">
                    {t.winRate === null ? "—" : `${fmt(t.winRate)}%`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Ledger */}
      <div className="card overflow-hidden p-0">
        <h3 className="border-b border-border p-4 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Bet ledger
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-secondary text-xs uppercase tracking-wide text-secondary-foreground">
              <tr>
                <th className="p-3 text-left">Date</th>
                <th className="p-3 text-left">Bet</th>
                <th className="p-3 text-right">Invested</th>
                <th className="p-3 text-right">Returned</th>
                <th className="p-3 text-right">Net</th>
                <th className="p-3 text-center">Result</th>
              </tr>
            </thead>
            <tbody>
              {s.bets.map((b) => (
                <tr key={b.id} className="border-t border-border">
                  <td className="p-3 text-xs text-muted-foreground">{new Date(b.savedAt).toLocaleDateString()}</td>
                  <td className="p-3">
                    <div className="font-medium">{b.title}</div>
                    <div className="text-xs text-muted-foreground">{b.participants.join(", ")}</div>
                  </td>
                  <td className="p-3 text-right font-mono">${fmt(b.totalStake)}</td>
                  <td className="p-3 text-right font-mono">{b.status === "Pending" ? "—" : `$${fmt(b.returned ?? 0)}`}</td>
                  <td className={cn("p-3 text-right font-mono font-semibold",
                    b.status === "Pending" ? "text-muted-foreground" : (b.netProfit ?? 0) >= 0 ? "text-success" : "text-destructive")}>
                    {b.status === "Pending" ? "—" : `${(b.netProfit ?? 0) >= 0 ? "+" : ""}$${fmt(b.netProfit ?? 0)}`}
                  </td>
                  <td className="p-3 text-center">
                    <span className={cn("rounded-full px-2 py-0.5 text-xs font-bold",
                      b.status === "Won" && "bg-success/15 text-success",
                      b.status === "Lost" && "bg-destructive/15 text-destructive",
                      b.status === "Pending" && "bg-warning/15 text-warning-foreground",
                    )}>{b.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </AppShell>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
  tone = "default",
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  tone?: "default" | "success" | "danger";
}) {
  return (
    <div className="card">
      <div className="flex items-center justify-between">
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
        <Icon className={cn("h-4 w-4",
          tone === "success" && "text-success",
          tone === "danger" && "text-destructive",
          tone === "default" && "text-primary",
        )} />
      </div>
      <div className={cn("mt-1 text-lg font-bold md:text-xl",
        tone === "success" && "text-success",
        tone === "danger" && "text-destructive",
      )}>{value}</div>
    </div>
  );
}

function DoughnutMock({ wins, losses }: { wins: number; losses: number }) {
  const total = wins + losses || 1;
  const winPct = (wins / total) * 100;
  return (
    <div
      className="grid h-28 w-28 shrink-0 place-items-center rounded-full"
      style={{
        background: `conic-gradient(var(--success) 0 ${winPct}%, var(--destructive) ${winPct}% 100%)`,
      }}
    >
      <div className="grid h-20 w-20 place-items-center rounded-full bg-card">
        <div className="text-center">
          <div className="text-xl font-bold">{Math.round(winPct)}%</div>
          <div className="text-[10px] text-muted-foreground">win rate</div>
        </div>
      </div>
    </div>
  );
}
