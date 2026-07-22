import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AppShell } from "@/components/app-shell";
import { sampleScannerResults, sampleFixtureArbs, fmt } from "@/lib/betmaster-data";
import { Radar, RefreshCw, ShieldCheck, AlertTriangle, ArrowRight, Clock } from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/scanner")({
  head: () => ({
    meta: [
      { title: "Scanner — BetMaster" },
      { name: "description", content: "Scan live bookmaker odds for profitable cover-betting combinations." },
      { property: "og:title", content: "Scanner — BetMaster" },
      { property: "og:description", content: "Find combinations that clear your profit floor across leagues and bookmakers." },
    ],
  }),
  component: ScannerPage,
});

function ScannerPage() {
  const [mode, setMode] = useState<"league" | "date">("league");
  const [size, setSize] = useState<2 | 3>(2);
  const [sameBook, setSameBook] = useState(false);
  const [minProfit, setMinProfit] = useState(1.0);
  const [sort, setSort] = useState<"profit" | "safe">("safe");

  const results = [...sampleScannerResults]
    .filter((r) => r.profitPct >= minProfit)
    .sort((a, b) => {
      if (a.fullCover !== b.fullCover) return a.fullCover ? -1 : 1;
      if (sort === "profit") return b.profitPct - a.profitPct;
      return (a.excludedProb ?? 0) - (b.excludedProb ?? 0);
    });

  return (
    <AppShell>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold md:text-3xl">Scanner</h1>
          <p className="text-sm text-muted-foreground">Find profitable cover combinations from live odds.</p>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <Clock className="h-4 w-4" /> Scanned 12 min ago
          <button className="btn-primary"><RefreshCw className="h-4 w-4" /> Rescan</button>
        </div>
      </div>

      {/* Scan mode tabs */}
      <div className="mb-4 inline-flex rounded-lg border border-border bg-card p-1">
        {(["league", "date"] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={cn(
              "rounded-md px-4 py-2 text-sm font-medium capitalize",
              mode === m ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-accent"
            )}
          >
            By {m}
          </button>
        ))}
      </div>

      {/* Controls */}
      <div className="card mb-4 grid gap-3 md:grid-cols-4">
        {mode === "league" ? (
          <div>
            <label className="label">League</label>
            <select className="input">
              <option>Premier League</option>
              <option>La Liga</option>
              <option>Serie A</option>
              <option>Bundesliga</option>
              <option>Ligue 1</option>
            </select>
          </div>
        ) : (
          <div>
            <label className="label">Match date</label>
            <input type="date" defaultValue="2026-07-25" className="input" />
          </div>
        )}
        <div>
          <label className="label">Bookmakers</label>
          <select className="input">
            <option>All (Europe)</option>
            <option>My accounts</option>
            <option>Pinnacle only</option>
          </select>
        </div>
        <div>
          <label className="label">Min profit %</label>
          <input type="number" step="0.1" value={minProfit} onChange={(e) => setMinProfit(+e.target.value || 0)} className="input" />
        </div>
        <div>
          <label className="label">Quota remaining</label>
          <div className="mt-1 rounded-md bg-secondary px-3 py-2 text-sm font-mono text-secondary-foreground">
            842 / 1000 units
          </div>
        </div>
      </div>

      {/* Result options */}
      <div className="mb-4 flex flex-wrap gap-2">
        <Chip active={size === 2} onClick={() => setSize(2)}>2 teams (9 scenarios)</Chip>
        <Chip active={size === 3} onClick={() => setSize(3)}>3 teams (27 scenarios)</Chip>
        <Chip active={sameBook} onClick={() => setSameBook((s) => !s)}>Same bookmaker</Chip>
        <Chip active={!sameBook} onClick={() => setSameBook(false)}>Best odds across books</Chip>
        <Chip active={sort === "profit"} onClick={() => setSort("profit")}>Highest profit %</Chip>
        <Chip active={sort === "safe"} onClick={() => setSort("safe")}>Safest first</Chip>
      </div>

      {/* Fixture arbs */}
      {sampleFixtureArbs.length > 0 && (
        <div className="mb-6">
          <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-primary">
            <ShieldCheck className="h-4 w-4" /> Single-fixture arbitrage
          </h2>
          <div className="grid gap-3 md:grid-cols-2">
            {sampleFixtureArbs.map((a) => (
              <div key={a.id} className="card border-success/40 bg-success/5">
                <div className="mb-2 flex items-center justify-between">
                  <div className="font-semibold">{a.home} v {a.away}</div>
                  <span className="rounded-full bg-success px-2 py-0.5 text-xs font-bold text-success-foreground">
                    +{fmt(a.profitPct)}% risk-free
                  </span>
                </div>
                <div className="text-xs text-muted-foreground">{a.league} · {a.kickoff}</div>
                <div className="mt-3 space-y-1 text-sm">
                  {a.legs.map((l) => (
                    <div key={l.outcome} className="flex justify-between">
                      <span className="font-mono">{l.outcome}</span>
                      <span>{fmt(l.odds)} @ <span className="font-semibold">{l.bookmaker}</span></span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Results */}
      <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-primary">
        <Radar className="h-4 w-4" /> Combinations ({results.length})
      </h2>
      <div className="space-y-3">
        {results.map((r) => (
          <div key={r.id} className={cn("card", r.fullCover && "border-success/40 bg-success/5")}>
            <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <span className={cn(
                    "rounded-full px-2 py-0.5 text-xs font-bold",
                    r.fullCover ? "bg-success text-success-foreground" : "bg-primary text-primary-foreground"
                  )}>
                    {r.coverage} covered
                  </span>
                  <span className="text-xs text-muted-foreground">via {r.bookmaker}</span>
                </div>
                <div className="space-y-0.5">
                  {r.fixtures.map((f, i) => (
                    <div key={i} className="text-sm font-medium">
                      {f.home} <span className="text-muted-foreground">v</span> {f.away}
                      <span className="ml-2 text-xs text-muted-foreground">{f.league} · {f.kickoff}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="text-right">
                <div className="text-2xl font-bold text-success">+{fmt(r.profitPct)}%</div>
                <div className="text-xs text-muted-foreground">on covered scenarios</div>
              </div>
            </div>
            <div className={cn(
              "flex items-start gap-2 rounded-md p-3 text-xs",
              r.fullCover ? "bg-success/10 text-success" : "bg-warning/10 text-warning-foreground"
            )}>
              {r.fullCover ? <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />}
              <span>
                {r.fullCover
                  ? `All ${r.coverage.split("/")[1]} scenarios covered — no losing outcome.`
                  : `${r.coverage} covered — loses only if ${r.excluded} (~${r.excludedProb}% implied chance).`}
              </span>
            </div>
            <div className="mt-3 flex justify-end">
              <button className="btn-primary">Load into Calculator <ArrowRight className="h-4 w-4" /></button>
            </div>
          </div>
        ))}
      </div>

      <p className="mt-6 text-xs text-muted-foreground">
        <strong>Note:</strong> "N−1 of N covered" is not risk-free — the excluded scenario is usually the bookmaker's favourite. Re-check odds at the bookmaker before placing.
      </p>
    </AppShell>
  );
}

function Chip({ active, children, onClick }: { active?: boolean; children: React.ReactNode; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded-full border px-3 py-1.5 text-xs font-medium transition",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-card text-foreground hover:bg-accent"
      )}
    >
      {children}
    </button>
  );
}
