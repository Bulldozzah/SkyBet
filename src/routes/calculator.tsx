import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { scenarioIndices, fmt } from "@/lib/betmaster-data";
import { Save, Download, RotateCcw, Scale, Target, Triangle } from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/calculator")({
  head: () => ({
    meta: [
      { title: "Calculator — BetMaster" },
      { name: "description", content: "Split your budget across every scenario. See stakes, returns and coverage in real time." },
      { property: "og:title", content: "Calculator — BetMaster" },
      { property: "og:description", content: "Cover-betting calculator with equal-profit and target-win balancing." },
    ],
  }),
  component: CalculatorPage,
});

const SPORTS = ["Football", "Basketball", "Tennis", "Hockey", "Cricket", "Rugby", "American Football", "Volleyball", "UFC", "Boxing"];

interface TeamRow { name: string; W: number; D: number; L: number; }

const defaultTeams = (n: number): TeamRow[] =>
  [
    { name: "Arsenal", W: 2.10, D: 3.40, L: 3.20 },
    { name: "Chelsea", W: 1.95, D: 3.50, L: 3.80 },
    { name: "Liverpool", W: 1.75, D: 3.80, L: 4.50 },
  ].slice(0, n);

function CalculatorPage() {
  const [sport, setSport] = useState("Football");
  const [tab, setTab] = useState<1 | 2 | 3>(2);
  const [budget, setBudget] = useState(100);
  const [tax, setTax] = useState(0.10);
  const [teams, setTeams] = useState<TeamRow[]>(defaultTeams(2));
  const [overrides, setOverrides] = useState<Record<number, { stake?: number; odds?: number; excluded?: boolean }>>({});
  const [targetWin, setTargetWin] = useState(120);

  const scenarios = useMemo(() => scenarioIndices(tab), [tab]);

  const rows = useMemo(() => {
    return scenarios.map((sc, i) => {
      const compOdds = sc.reduce((p, o, t) => p * (teams[t]?.[o] ?? 0), 1);
      const o = overrides[i] ?? {};
      const odds = o.odds ?? Math.round(compOdds * 100) / 100;
      return {
        i,
        legs: sc,
        odds,
        stake: o.stake ?? 0,
        excluded: o.excluded ?? false,
      };
    });
  }, [scenarios, teams, overrides]);

  const totalStake = rows.reduce((s, r) => s + r.stake, 0);
  const remaining = budget - totalStake;

  const setTeam = (idx: number, patch: Partial<TeamRow>) => {
    setTeams((prev) => {
      const next = [...prev];
      while (next.length < tab) next.push({ name: "", W: 0, D: 0, L: 0 });
      next[idx] = { ...next[idx], ...patch };
      return next.slice(0, tab);
    });
  };

  const setTabAndTeams = (n: 1 | 2 | 3) => {
    setTab(n);
    setTeams((prev) => {
      const next = [...prev];
      while (next.length < n) {
        const d = defaultTeams(3)[next.length];
        next.push(d ?? { name: "", W: 2, D: 3.4, L: 3.2 });
      }
      return next.slice(0, n);
    });
    setOverrides({});
  };

  const balanceEqualProfit = () => {
    const m = rows.map((r) => r.odds * (1 - tax) + tax);
    const eligible = rows.map((r, i) => (r.odds > 1 && !r.excluded ? i : -1)).filter((i) => i >= 0);
    if (eligible.length === 0) return;
    const invSum = eligible.reduce((s, i) => s + 1 / m[i], 0);
    const next: typeof overrides = { ...overrides };
    let allocated = 0;
    let largest = eligible[0];
    eligible.forEach((i) => {
      const s = Math.round(((budget / m[i]) / invSum) * 100) / 100;
      next[i] = { ...next[i], stake: s };
      allocated += s;
      if (s > (next[largest]?.stake ?? 0)) largest = i;
    });
    // zero out non-eligible
    rows.forEach((r, i) => {
      if (!eligible.includes(i)) next[i] = { ...next[i], stake: 0 };
    });
    const remainder = Math.round((budget - allocated) * 100) / 100;
    if (remainder !== 0) next[largest] = { ...next[largest], stake: (next[largest]?.stake ?? 0) + remainder };
    setOverrides(next);
  };

  const balanceTargetWin = () => {
    const eligible = rows.map((r, i) => (r.odds > 1 && !r.excluded ? i : -1)).filter((i) => i >= 0);
    const needed = eligible.reduce((s, i) => s + targetWin / rows[i].odds, 0);
    if (needed > budget) {
      alert(`Not enough budget. Need ${fmt(needed)} — max win at current budget is ${fmt(budget / eligible.reduce((s, i) => s + 1 / rows[i].odds, 0))}`);
      return;
    }
    const next: typeof overrides = { ...overrides };
    rows.forEach((r, i) => {
      if (eligible.includes(i)) next[i] = { ...next[i], stake: Math.ceil((targetWin / r.odds) * 100) / 100 };
      else next[i] = { ...next[i], stake: 0 };
    });
    setOverrides(next);
  };

  const reset = () => {
    setBudget(100);
    setTax(0);
    setOverrides({});
    setTeams(defaultTeams(tab));
  };

  return (
    <AppShell>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold md:text-3xl">Calculator</h1>
          <p className="text-sm text-muted-foreground">Split your budget across every scenario.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={reset} className="btn-secondary"><RotateCcw className="h-4 w-4" /> Reset</button>
          <button className="btn-secondary"><Download className="h-4 w-4" /> Export PDF</button>
          <button className="btn-primary"><Save className="h-4 w-4" /> Save bet</button>
        </div>
      </div>

      {/* Live counters */}
      <div className="mb-4 grid grid-cols-3 gap-3">
        <StatCard label="Budget" value={`$${fmt(budget)}`} />
        <StatCard label="Total stake" value={`$${fmt(totalStake)}`} />
        <StatCard label="Remaining" value={`$${fmt(remaining)}`} tone={remaining < 0 ? "danger" : "default"} />
      </div>

      {/* Controls */}
      <div className="mb-4 grid gap-3 md:grid-cols-3">
        <div className="card">
          <label className="label">Sport</label>
          <select value={sport} onChange={(e) => setSport(e.target.value)} className="input">
            {SPORTS.map((s) => <option key={s}>{s}</option>)}
          </select>
        </div>
        <div className="card">
          <label className="label">Budget</label>
          <input type="number" value={budget} onChange={(e) => setBudget(+e.target.value || 0)} className="input" />
        </div>
        <div className="card">
          <label className="label">Tax rate</label>
          <input type="number" step="0.01" value={tax} onChange={(e) => setTax(+e.target.value || 0)} className="input" />
        </div>
      </div>

      {/* Tabs */}
      <div className="mb-4 inline-flex rounded-lg border border-border bg-card p-1">
        {([1, 2, 3] as const).map((n) => (
          <button
            key={n}
            onClick={() => setTabAndTeams(n)}
            className={cn(
              "flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition",
              tab === n ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-accent"
            )}
          >
            {n} event{n > 1 ? "s" : ""}
            <span className={cn("rounded-full px-2 py-0.5 text-xs", tab === n ? "bg-white/20" : "bg-secondary")}>
              {Math.pow(3, n)}
            </span>
          </button>
        ))}
      </div>

      {/* Teams */}
      <div className="card mb-4">
        <h2 className="mb-3 font-semibold">Participants & odds</h2>
        <div className="space-y-3">
          {Array.from({ length: tab }).map((_, i) => {
            const t = teams[i] ?? { name: "", W: 0, D: 0, L: 0 };
            return (
              <div key={i} className="grid grid-cols-[auto_minmax(0,1fr)_repeat(3,minmax(0,1fr))] items-center gap-2">
                <div className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-primary/10 text-sm font-bold text-primary">
                  {String.fromCharCode(65 + i)}
                </div>
                <input
                  value={t.name}
                  onChange={(e) => setTeam(i, { name: e.target.value })}
                  placeholder="Team name"
                  className="input"
                />
                <input type="number" step="0.01" value={t.W || ""} onChange={(e) => setTeam(i, { W: +e.target.value || 0 })} placeholder="W" className="input" />
                <input type="number" step="0.01" value={t.D || ""} onChange={(e) => setTeam(i, { D: +e.target.value || 0 })} placeholder="D" className="input" />
                <input type="number" step="0.01" value={t.L || ""} onChange={(e) => setTeam(i, { L: +e.target.value || 0 })} placeholder="L" className="input" />
              </div>
            );
          })}
        </div>
      </div>

      {/* Balancing actions */}
      <div className="card mb-4 flex flex-wrap items-center gap-3">
        <button onClick={balanceEqualProfit} className="btn-primary"><Scale className="h-4 w-4" /> Balance (equal profit)</button>
        <div className="flex items-center gap-2">
          <button onClick={balanceTargetWin} className="btn-secondary"><Target className="h-4 w-4" /> Balance win</button>
          <input type="number" value={targetWin} onChange={(e) => setTargetWin(+e.target.value || 0)} className="input w-28" />
        </div>
      </div>

      {/* Scenario table */}
      <div className="card overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-secondary text-xs uppercase tracking-wide text-secondary-foreground">
              <tr>
                <th className="p-3 text-left">Inc.</th>
                <th className="p-3 text-left">Scenario</th>
                <th className="p-3 text-right">Stake</th>
                <th className="p-3 text-right">Odds</th>
                <th className="p-3 text-right">Total win</th>
                <th className="p-3 text-right">Profit</th>
                <th className="p-3 text-center">Status</th>
                <th className="p-3 text-right">Profit %</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const gross = r.stake * r.odds;
                const taxAmt = (gross - r.stake) * tax;
                const net = gross - taxAmt;
                const profit = net - totalStake;
                const covered = gross >= totalStake && r.stake > 0;
                const profitPct = budget > 0 ? (profit / budget) * 100 : 0;
                return (
                  <tr key={r.i} className={cn("border-t border-border", r.excluded && "opacity-40")}>
                    <td className="p-3">
                      <input
                        type="checkbox"
                        checked={!r.excluded}
                        onChange={(e) => setOverrides((o) => ({ ...o, [r.i]: { ...o[r.i], excluded: !e.target.checked } }))}
                        className="h-4 w-4 accent-primary"
                      />
                    </td>
                    <td className="p-3">
                      <div className="text-xs text-muted-foreground">
                        {r.legs.map((_, t) => teams[t]?.name || String.fromCharCode(65 + t)).join(" + ")}
                      </div>
                      <div className="font-mono text-sm font-semibold">{r.legs.join(" · ")}</div>
                    </td>
                    <td className="p-3 text-right">
                      <input
                        type="number"
                        step="0.01"
                        value={r.stake || ""}
                        onChange={(e) => setOverrides((o) => ({ ...o, [r.i]: { ...o[r.i], stake: +e.target.value || 0 } }))}
                        className="input w-24 text-right"
                      />
                    </td>
                    <td className="p-3 text-right">
                      <input
                        type="number"
                        step="0.01"
                        value={r.odds || ""}
                        onChange={(e) => setOverrides((o) => ({ ...o, [r.i]: { ...o[r.i], odds: +e.target.value || 0 } }))}
                        className="input w-20 text-right"
                      />
                    </td>
                    <td className="p-3 text-right font-mono">{fmt(gross)}</td>
                    <td className={cn("p-3 text-right font-mono font-semibold", profit >= 0 ? "text-success" : "text-destructive")}>
                      {profit >= 0 ? "+" : ""}{fmt(profit)}
                    </td>
                    <td className="p-3 text-center">
                      {r.stake === 0 ? (
                        <span className="text-xs text-muted-foreground">—</span>
                      ) : covered ? (
                        <Triangle className="mx-auto h-5 w-5 fill-success text-success" />
                      ) : (
                        <Triangle className="mx-auto h-5 w-5 rotate-180 fill-destructive text-destructive" />
                      )}
                    </td>
                    <td className={cn("p-3 text-right font-mono", profit >= 0 ? "text-success" : "text-destructive")}>
                      {fmt(profitPct)}%
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </AppShell>
  );
}

function StatCard({ label, value, tone = "default" }: { label: string; value: string; tone?: "default" | "danger" | "success" }) {
  return (
    <div className="card">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={cn(
        "mt-1 text-lg font-bold md:text-2xl",
        tone === "danger" && "text-destructive",
        tone === "success" && "text-success",
      )}>{value}</div>
    </div>
  );
}
