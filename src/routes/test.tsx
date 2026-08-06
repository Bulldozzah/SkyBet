// The Test workbench — a second, opinionated read of the same odds the Scanner
// already fetched.
//
// The Scanner answers "what pays well and lands often". This answers "what is
// actually worth taking", which is a different question with a different (and
// usually less flattering) answer. Nothing here spends API credits: it reads
// the Scanner's cached scan, or bundled demo data.

import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Scale,
  Layers,
  Store,
  Activity,
  ArrowRight,
  AlertTriangle,
  Beaker,
  Info,
  Eye,
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { ProtectedRoute } from "@/components/protected-route";
import { Alert } from "@/components/auth-shell";
import { ComboPreviewModal } from "@/components/combo-preview";
import { eventExposures, openBetClashes } from "@/lib/exposure";
import { useOpenBets } from "@/hooks/use-open-bets";
import { cn } from "@/lib/utils";
import type { Game } from "@/lib/odds-api";
import {
  scanCombos,
  buildComboBet,
  bestOdds,
  invSum,
  impliedProb,
  excludePatternKey,
  exclPatternOptions,
  OUTCOMES,
  type ComboResult,
  type OddsTriple,
  type ScanMode,
} from "@/lib/scanner";
import {
  expectedPer100,
  marketMargin,
  evaluateRows,
  correlationNote,
  matchesExclFilter,
  signedPct,
  type MarketMargin,
} from "@/lib/edge";
import { getDemoGames } from "@/lib/demo-odds";
import { readScanCache } from "@/lib/scan-cache";
import { inTimeWindow } from "@/lib/time-window";
import { supabase, type Bet } from "@/lib/supabase";
import { computeBet, fmt, withinPeriod, PERIODS } from "@/lib/bet-stats";
import { formatDateTimeLocal, formatDate } from "@/lib/format-date";

export const Route = createFileRoute("/test")({
  head: () => ({
    meta: [
      { title: "Test — BetMaster" },
      {
        name: "description",
        content:
          "Value workbench: ranks cover bets by expected return rather than by payout, and compares bet structures on the same odds.",
      },
      { property: "og:title", content: "Test — BetMaster" },
      {
        property: "og:description",
        content: "Expected-value analysis over the Scanner's cached odds.",
      },
    ],
  }),
  component: TestRoute,
});

function TestRoute() {
  return (
    <ProtectedRoute>
      <TestPage />
    </ProtectedRoute>
  );
}

const TABS = [
  {
    key: "value",
    label: "Value ranking",
    icon: Scale,
    blurb: "Every structure, ranked by what it is worth rather than what it pays.",
  },
  {
    key: "structures",
    label: "Structure ladder",
    icon: Layers,
    blurb: "The same odds bet four different ways, side by side.",
  },
  {
    key: "markets",
    label: "Market margins",
    icon: Store,
    blurb: "Shop the overround — the only number that moves expected value.",
  },
  {
    key: "ledger",
    label: "Expected vs actual",
    icon: Activity,
    blurb: "What your saved bets were worth at placement, against what they returned.",
  },
] as const;

type TabKey = (typeof TABS)[number]["key"];

// Combinatorics grow fast (C(n,3)), and the tightest markets are the only ones
// that can produce good value anyway, so the workbench works from the N
// lowest-overround games rather than everything scanned.
const POOL = 14;
const MAX_ROWS = 40;

/** The odds a given mode would actually get you on one game. */
const oddsForMode = (game: Game, mode: ScanMode): OddsTriple | null => {
  if (game.books.length === 0) return null;
  if (mode === "cross") return bestOdds(game).odds;
  // Single-book mode can only use one book's prices, so the best it can do is
  // that game's tightest book.
  let best: OddsTriple | null = null;
  let bestS = Infinity;
  for (const bk of game.books) {
    const s = invSum(bk);
    if (s < bestS) {
      bestS = s;
      best = { W: bk.W, D: bk.D, L: bk.L };
    }
  }
  return best;
};

const evTone = (per100: number): string =>
  per100 >= 100 ? "text-success" : per100 >= 96 ? "text-warning" : "text-destructive";

function StatTile({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: string;
  tone?: string;
  hint?: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-secondary/40 px-3 py-2">
      <div className="label mb-0.5">{label}</div>
      <div className={cn("text-lg font-extrabold leading-tight", tone ?? "text-foreground")}>
        {value}
      </div>
      {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}

function TestPage() {
  const navigate = useNavigate();

  const [tab, setTab] = useState<TabKey>("value");
  const [games, setGames] = useState<Game[] | null>(null);
  const [source, setSource] = useState("");
  const [scannedAt, setScannedAt] = useState<number | null>(null);
  const [mode, setMode] = useState<ScanMode>("cross");
  const [legCount, setLegCount] = useState(2);
  const [minPct, setMinPct] = useState("0");
  // Uncovered-scenario patterns to keep, e.g. ["WL", "DL"]. Keys for every
  // structure size live together; only same-length keys apply to a given row.
  const [exclFilter, setExclFilter] = useState<string[]>([]);
  // Kickoff time-of-day window over the cached games. The checkbox is the
  // master switch, so unticking removes the time factor without losing the
  // typed window — flip between an AM shortlist and the whole day freely.
  const [timeOn, setTimeOn] = useState(false);
  const [timeFrom, setTimeFrom] = useState("");
  const [timeTo, setTimeTo] = useState("");

  // localStorage is browser-only, so this cannot run in a state initializer
  // without desyncing hydration.
  useEffect(() => {
    const cached = readScanCache();
    if (cached) {
      setGames(cached.games);
      setSource(cached.source === "demo" ? "demo" : "scan");
      setScannedAt(cached.scannedAt);
    }
  }, []);

  const loadDemo = () => {
    setGames(getDemoGames());
    setSource("demo");
    setScannedAt(Date.now());
  };

  // Games the workbench computes over: the cached scan, optionally narrowed
  // to the kickoff window so every structure (1, 2 or 3 games) is built purely
  // from games inside it.
  const timedGames = useMemo(() => {
    if (!games || !timeOn) return games;
    return games.filter((g) => inTimeWindow(g.commence, timeFrom, timeTo));
  }, [games, timeOn, timeFrom, timeTo]);

  // Margins for every scanned game, tightest first. Drives the Markets tab and
  // the pool every other tab computes over.
  const margins = useMemo(() => {
    if (!timedGames) return [];
    return timedGames
      .map((g) => marketMargin(g))
      .filter((m): m is MarketMargin => m !== null)
      .sort((a, b) => (mode === "cross" ? a.bestPct - b.bestPct : a.singlePct - b.singlePct));
  }, [timedGames, mode]);

  const pool = useMemo(() => margins.slice(0, POOL).map((m) => m.game), [margins]);

  const floor = Math.max(0, parseFloat(minPct) || 0);

  /** Every qualifying combo at the selected structure, ranked by expected value. */
  const rankedAll = useMemo(() => {
    if (pool.length < legCount) return [];
    const out = Array.from(scanCombos(pool, mode, floor, legCount), (result) => ({
      result,
      per100: expectedPer100(result.gamesOdds),
      legs: legCount,
    }));
    // Expected value first; among equals prefer the one that lands more often,
    // since variance is the only thing left to choose on.
    return out.sort((a, b) => b.per100 - a.per100 || a.result.exclProb - b.result.exclProb);
  }, [pool, mode, floor, legCount]);

  // How many results each uncovered-scenario pattern would keep, counted before
  // the filter is applied so the chips don't all read 0 once one is selected.
  const patternCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const { result } of rankedAll) {
      if (!result.excludeLabel) continue;
      const key = excludePatternKey(result.excludeLabel);
      counts[key] = (counts[key] ?? 0) + 1;
    }
    return counts;
  }, [rankedAll]);

  const ranked = useMemo(
    () =>
      rankedAll
        .filter(({ result, legs: n }) =>
          matchesExclFilter(exclFilter, n, result.excludeLabel, result.fullCover),
        )
        .slice(0, MAX_ROWS),
    [rankedAll, exclFilter],
  );

  const openInCalculator = (result: ComboResult) =>
    navigate({ to: "/calculator", state: { loadBet: buildComboBet(result) } as never });

  // Pattern keys are structure-specific, so a stale selection from the previous
  // size would read as a filter that no longer matches anything on screen.
  const changeLegCount = (n: number) => {
    setLegCount(n);
    setExclFilter([]);
  };

  const togglePattern = (k: string) =>
    setExclFilter((prev) => (prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k]));

  const windowInverted = timeOn && !!timeFrom && !!timeTo && timeFrom > timeTo;

  const active = TABS.find((t) => t.key === tab)!;

  return (
    <AppShell>
      <div className="mb-6">
        <h1 className="flex items-center gap-2 text-2xl font-extrabold text-foreground">
          <Beaker className="h-6 w-6 text-primary" />
          Test
        </h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          A value-first read of the odds the Scanner already fetched. The Scanner ranks on what a
          bet pays and how often it lands; this ranks on what it is worth. Nothing here spends API
          credits.
        </p>
      </div>

      {/* Shared data bar */}
      <div className="card mb-6">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <span className="label">Odds source</span>
            <div className="text-sm font-semibold">
              {games ? (
                <>
                  {source === "demo" ? "Demo data" : "Scanner cache"} · {games.length} games
                  {scannedAt ? ` · ${formatDateTimeLocal(scannedAt)}` : ""}
                </>
              ) : (
                "Nothing loaded"
              )}
            </div>
          </div>

          <div>
            <span className="label">Odds mode</span>
            <div className="inline-flex rounded-lg border border-border bg-card p-1">
              {(
                [
                  ["cross", "Best across books"],
                  ["single", "One bookmaker"],
                ] as const
              ).map(([k, l]) => (
                <button
                  key={k}
                  onClick={() => setMode(k)}
                  className={cn(
                    "rounded-md px-3 py-1.5 text-xs font-semibold transition",
                    mode === k
                      ? "bg-primary text-primary-foreground"
                      : "text-foreground hover:bg-accent",
                  )}
                >
                  {l}
                </button>
              ))}
            </div>
          </div>

          {/* Kickoff window — narrows the pool every tab computes over, so
              all structures (1/2/3 games) obey it. Untick to remove the time
              factor without losing the typed window. */}
          <div title="Only build from games kicking off inside this local-time window">
            <label
              className="label flex w-fit cursor-pointer items-center gap-1.5"
              htmlFor="test-time-on"
            >
              <input
                id="test-time-on"
                type="checkbox"
                checked={timeOn}
                onChange={(e) => setTimeOn(e.target.checked)}
                className="h-3.5 w-3.5 accent-primary"
              />
              Kickoff time
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="time"
                value={timeFrom}
                onChange={(e) => setTimeFrom(e.target.value)}
                disabled={!timeOn}
                aria-label="Kickoff from time"
                className="input w-auto disabled:opacity-50"
              />
              <span className="text-xs text-muted-foreground">to</span>
              <input
                type="time"
                value={timeTo}
                onChange={(e) => setTimeTo(e.target.value)}
                disabled={!timeOn}
                aria-label="Kickoff to time"
                className="input w-auto disabled:opacity-50"
              />
            </div>
          </div>

          <button onClick={loadDemo} className="btn-secondary text-xs">
            Load demo odds
          </button>
        </div>

        {games && timeOn && (
          <p
            className={cn(
              "mt-3 text-xs",
              windowInverted || timedGames?.length === 0
                ? "text-destructive"
                : "text-muted-foreground",
            )}
          >
            {windowInverted
              ? "The window ends before it starts, so nothing matches. Windows do not wrap past midnight."
              : `${timedGames?.length ?? 0} of ${games.length} games kick off between ${
                  timeFrom || "00:00"
                } and ${timeTo || "23:59"} — every tab below builds only from those.`}
          </p>
        )}

        {!games && (
          <p className="mt-3 text-sm text-muted-foreground">
            No cached scan found. Run a scan on the{" "}
            <Link to="/scanner" className="font-semibold text-primary hover:underline">
              Scanner
            </Link>{" "}
            and come back, or load demo odds to see how this works.
          </p>
        )}
      </div>

      <div className="flex flex-col gap-6 lg:flex-row">
        {/* Vertical tabs */}
        <nav
          role="tablist"
          aria-orientation="vertical"
          className="flex shrink-0 gap-2 overflow-x-auto lg:w-64 lg:flex-col lg:overflow-visible"
        >
          {TABS.map((t) => {
            const Icon = t.icon;
            return (
              <button
                key={t.key}
                role="tab"
                aria-selected={tab === t.key}
                onClick={() => setTab(t.key)}
                className={cn(
                  "flex shrink-0 items-center gap-3 rounded-lg border px-3 py-2.5 text-left text-sm font-semibold transition lg:w-full",
                  tab === t.key
                    ? "border-primary bg-primary text-primary-foreground shadow-sm"
                    : "border-border bg-card text-foreground hover:bg-accent",
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span>{t.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="min-w-0 flex-1">
          <p className="mb-4 text-sm text-muted-foreground">{active.blurb}</p>

          {tab === "value" && (
            <ValueTab
              ranked={ranked}
              legCount={legCount}
              setLegCount={changeLegCount}
              minPct={minPct}
              setMinPct={setMinPct}
              hasGames={!!games}
              poolSize={pool.length}
              onLoad={openInCalculator}
              exclFilter={exclFilter}
              togglePattern={togglePattern}
              clearPatterns={() => setExclFilter([])}
              patternCounts={patternCounts}
              hiddenByFilter={rankedAll.length - ranked.length}
            />
          )}
          {tab === "structures" && (
            <StructuresTab pool={pool} mode={mode} onLoad={openInCalculator} />
          )}
          {tab === "markets" && <MarketsTab margins={margins} mode={mode} />}
          {tab === "ledger" && <LedgerTab />}
        </div>
      </div>
    </AppShell>
  );
}

/* ------------------------------------------------------------------ value */

function ValueTab({
  ranked,
  legCount,
  setLegCount,
  minPct,
  setMinPct,
  hasGames,
  poolSize,
  onLoad,
  exclFilter,
  togglePattern,
  clearPatterns,
  patternCounts,
  hiddenByFilter,
}: {
  ranked: { result: ComboResult; per100: number; legs: number }[];
  legCount: number;
  setLegCount: (n: number) => void;
  minPct: string;
  setMinPct: (v: string) => void;
  hasGames: boolean;
  poolSize: number;
  onLoad: (r: ComboResult) => void;
  exclFilter: string[];
  togglePattern: (k: string) => void;
  clearPatterns: () => void;
  patternCounts: Record<string, number>;
  hiddenByFilter: number;
}) {
  // The combo open in the preview modal, with the value figures that got it
  // ranked here (null = closed).
  const [preview, setPreview] = useState<{ result: ComboResult; per100: number } | null>(null);
  // Unsettled bets. correlationNote below flags correlation *inside* a combo;
  // this catches the other kind — a fixture already staked on another bet.
  const { openBets } = useOpenBets();
  const clashesFor = useCallback(
    (gs: Game[]) => openBetClashes(eventExposures(gs, null, gs.length), openBets),
    [openBets],
  );
  // Whether to drop combos that touch a fixture already staked.
  const [hideExposed, setHideExposed] = useState(false);
  const exposedCount = useMemo(
    () => ranked.filter((r) => clashesFor(r.result.games).length > 0).length,
    [ranked, clashesFor],
  );
  const visible = useMemo(
    () => (hideExposed ? ranked.filter((r) => clashesFor(r.result.games).length === 0) : ranked),
    [ranked, hideExposed, clashesFor],
  );
  const positive = visible.filter((r) => r.per100 >= 100).length;

  return (
    <div className="space-y-4">
      <div className="card">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label className="label" htmlFor="test-structure">
              Structure
            </label>
            <select
              id="test-structure"
              value={legCount}
              onChange={(e) => setLegCount(Number(e.target.value))}
              className="input w-auto"
            >
              {[1, 2, 3].map((n) => (
                <option key={n} value={n}>
                  {n} game{n === 1 ? "" : "s"} ({Math.pow(3, n) - 1} of {Math.pow(3, n)})
                </option>
              ))}
            </select>
          </div>
          <div className="w-32">
            <label className="label" htmlFor="test-minpct">
              Min payout %
            </label>
            <input
              id="test-minpct"
              value={minPct}
              onChange={(e) => setMinPct(e.target.value)}
              inputMode="decimal"
              className="input"
            />
          </div>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          2 games (8 of 9) is the default. The 1-game structure is the one the Scanner cannot show
          you — it only offers 2 and 3 — and it usually ranks best here, because each extra leg
          multiplies in another bookmaker margin.
        </p>

        <div className="mt-4 border-t border-border pt-3">
          <span className="label">Uncovered scenario</span>
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              onClick={clearPatterns}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-semibold transition",
                exclFilter.length === 0
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card text-foreground hover:bg-accent",
              )}
            >
              Any
            </button>
            {exclPatternOptions(legCount).map((k) => (
              <button
                key={k}
                onClick={() => togglePattern(k)}
                title={`Keep only combos whose uncovered scenario is ${k.split("").join(" + ")}`}
                className={cn(
                  "rounded-full border px-2.5 py-1 font-mono text-xs font-semibold transition",
                  exclFilter.includes(k)
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-card text-foreground hover:bg-accent",
                )}
              >
                {k.split("").join("+")} <span className="opacity-60">{patternCounts[k] ?? 0}</span>
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Which outcomes the one uncovered scenario may pair — e.g. W+L keeps only combos that
            lose when one side wins and the other loses. Which game sits in the A slot is an
            accident of fetch order, so W+L and L+W are one pattern. Selecting nothing leaves the
            structure unfiltered, and guaranteed full covers always stay.
            {hiddenByFilter > 0 ? ` ${hiddenByFilter} result(s) hidden.` : ""}
          </p>
        </div>
      </div>

      {!hasGames ? null : visible.length === 0 ? (
        <div className="card text-sm text-muted-foreground">
          {hideExposed && exposedCount > 0 && ranked.length === exposedCount
            ? `All ${ranked.length} qualifying results involve a fixture you already have an unsettled bet on. Switch back to All to see them.`
            : hiddenByFilter > 0
              ? `All ${hiddenByFilter} qualifying results are hidden by the uncovered-scenario filter. Select more patterns, or set it back to Any.`
              : `Nothing qualifies from the ${poolSize} tightest markets at this payout floor. Lower it, or pick a different structure.`}
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-baseline gap-x-2 rounded-lg border border-border bg-card px-4 py-2">
            <span className="text-lg font-extrabold leading-none text-primary">
              {visible.length}
            </span>
            <span className="text-sm font-semibold">ranked by expected value</span>
            <span className="text-xs text-muted-foreground">
              · {positive} above break-even
              {positive === 0 ? " — every option below loses money on average" : ""}
              {hideExposed && exposedCount > 0 ? ` · ${exposedCount} hidden as exposed` : ""}
            </span>
            {(exposedCount > 0 || hideExposed) && (
              <div className="ml-auto flex items-center gap-1">
                {[
                  { on: false, label: `All (${ranked.length})` },
                  { on: true, label: `Unexposed only (${ranked.length - exposedCount})` },
                ].map((opt) => (
                  <button
                    key={String(opt.on)}
                    onClick={() => setHideExposed(opt.on)}
                    title={
                      opt.on
                        ? "Hide combos touching a fixture you already have an unsettled bet on"
                        : "Show every ranked combo, including ones you are already exposed to"
                    }
                    className={cn(
                      "rounded-full border px-3 py-1 text-xs font-semibold transition",
                      hideExposed === opt.on
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-card text-foreground hover:bg-accent",
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {visible.map(({ result, per100, legs: n }, i) => {
            const corr = correlationNote(result.games);
            const hitRate = (1 - result.exclProb) * 100;
            return (
              <div key={`${n}-${result.games.map((g) => g.id).join("-")}-${i}`} className="card">
                <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="mb-1 flex flex-wrap items-center gap-2">
                      <span className="rounded bg-secondary px-2 py-0.5 text-xs font-bold text-secondary-foreground">
                        {n} game{n === 1 ? "" : "s"}
                      </span>
                      <span
                        className={cn(
                          "rounded px-2 py-0.5 text-xs font-bold text-white",
                          result.fullCover ? "bg-success" : "bg-primary",
                        )}
                      >
                        {result.fullCover
                          ? `all ${Math.pow(3, n)} covered`
                          : `${Math.pow(3, n) - 1} of ${Math.pow(3, n)} covered`}
                      </span>
                      {corr && (
                        <span className="flex items-center gap-1 rounded bg-warning/15 px-2 py-0.5 text-xs font-semibold text-warning">
                          <AlertTriangle className="h-3 w-3" />
                          {corr}
                        </span>
                      )}
                      {clashesFor(result.games).length > 0 && (
                        <span
                          title="A fixture here is already carrying an unsettled bet — open the preview for details"
                          className="flex items-center gap-1 rounded bg-destructive/15 px-2 py-0.5 text-xs font-semibold text-destructive"
                        >
                          <AlertTriangle className="h-3 w-3" />
                          already exposed
                        </span>
                      )}
                    </div>
                    {result.games.map((g) => (
                      <div key={g.id} className="truncate text-sm font-semibold">
                        {g.home} v {g.away}
                        <span className="ml-2 text-xs font-normal text-muted-foreground">
                          {formatDateTimeLocal(g.commence)}
                          {g.league ? ` · ${g.league}` : ""}
                        </span>
                      </div>
                    ))}
                    <div className="mt-1 truncate text-xs text-muted-foreground">
                      via {result.bookLabel}
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <button
                      onClick={() => setPreview({ result, per100 })}
                      className="btn-secondary py-1.5 text-xs"
                    >
                      <Eye className="h-3.5 w-3.5" /> Preview
                    </button>
                    <button onClick={() => onLoad(result)} className="btn-primary py-1.5 text-xs">
                      Load into Calculator
                      <ArrowRight className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  <StatTile
                    label="Expected per 100"
                    value={per100.toFixed(2)}
                    tone={evTone(per100)}
                    hint={
                      per100 >= 100 ? "genuine edge" : `${signedPct(per100 - 100)} per turnover`
                    }
                  />
                  <StatTile
                    label="Hit rate"
                    value={`${hitRate.toFixed(1)}%`}
                    hint={result.fullCover ? "cannot lose" : "book's implied chance"}
                  />
                  <StatTile
                    label="Pays when it hits"
                    value={signedPct(result.profitPct)}
                    hint={
                      result.excludeLabel ? `loses on ${result.excludeLabel}` : "every scenario"
                    }
                  />
                </div>
              </div>
            );
          })}
        </>
      )}

      {preview && (
        <ComboPreviewModal
          result={preview.result}
          openBets={openBets}
          onClose={() => setPreview(null)}
          onLoad={() => {
            onLoad(preview.result);
            setPreview(null);
          }}
          extra={
            // The Scanner's preview answers "what does each scenario pay".
            // Here the ranking is by value, so the preview leads with that.
            <div className="mb-3 grid grid-cols-3 gap-2">
              <StatTile
                label="Expected per 100"
                value={preview.per100.toFixed(2)}
                tone={evTone(preview.per100)}
              />
              <StatTile
                label="Hit rate"
                value={`${((1 - preview.result.exclProb) * 100).toFixed(1)}%`}
              />
              <StatTile label="Pays when it hits" value={signedPct(preview.result.profitPct, 1)} />
            </div>
          }
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------- structures */

interface Rung {
  name: string;
  covers: string;
  hitRate: number;
  payout: number;
  per100: number;
  detail: string;
  result?: ComboResult;
}

function StructuresTab({
  pool,
  mode,
  onLoad,
}: {
  pool: Game[];
  mode: ScanMode;
  onLoad: (r: ComboResult) => void;
}) {
  const rungs = useMemo((): Rung[] => {
    if (pool.length === 0) return [];
    const out: Rung[] = [];

    // Baseline: back the single most likely outcome in the tightest market.
    // Same market, same margin, wildly different risk profile — which is the
    // point of showing it next to the 2-of-3 cover.
    const odds = oddsForMode(pool[0], mode);
    if (odds) {
      const fav = OUTCOMES.reduce((a, o) => (odds[o] < odds[a] ? o : a), OUTCOMES[0]);
      out.push({
        name: "Straight single",
        covers: "1 of 3",
        hitRate: impliedProb(odds, fav) * 100,
        payout: (odds[fav] - 1) * 100,
        per100: expectedPer100([odds]),
        detail: `${pool[0].home} v ${pool[0].away} — back ${fav} at ${odds[fav].toFixed(2)}`,
      });
    }

    // Best available cover at each leg count, by expected value.
    for (const n of [1, 2, 3]) {
      if (pool.length < n) continue;
      const best = scanCombos(pool, mode, 0, n)
        .map((result) => ({ result, per100: expectedPer100(result.gamesOdds) }))
        .sort((a, b) => b.per100 - a.per100 || a.result.exclProb - b.result.exclProb)[0];
      if (!best) continue;
      out.push({
        name: `${n}-game cover`,
        covers: `${Math.pow(3, n) - 1} of ${Math.pow(3, n)}`,
        hitRate: (1 - best.result.exclProb) * 100,
        payout: best.result.profitPct,
        per100: best.per100,
        detail: best.result.games.map((g) => `${g.home} v ${g.away}`).join("  +  "),
        result: best.result,
      });
    }
    return out;
  }, [pool, mode]);

  if (rungs.length === 0) {
    return (
      <div className="card text-sm text-muted-foreground">
        Load a scan or demo odds to build the ladder.
      </div>
    );
  }

  const single = rungs.find((r) => r.name === "Straight single");
  const oneGame = rungs.find((r) => r.name === "1-game cover");
  const twoGame = rungs.find((r) => r.name === "2-game cover");
  const best = rungs.reduce((a, r) => (r.per100 > a.per100 ? r : a), rungs[0]);

  return (
    <div className="space-y-4">
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[40rem] text-sm">
          <thead>
            <tr className="border-b border-border text-left">
              <th className="pb-2 pr-3 font-bold">Structure</th>
              <th className="pb-2 pr-3 font-bold">Covers</th>
              <th className="pb-2 pr-3 text-right font-bold">Hit rate</th>
              <th className="pb-2 pr-3 text-right font-bold">Pays when it hits</th>
              <th className="pb-2 pr-3 text-right font-bold">Expected per 100</th>
              <th className="pb-2" />
            </tr>
          </thead>
          <tbody>
            {rungs.map((r) => (
              <tr key={r.name} className="border-b border-border/60 last:border-0">
                <td className="py-2.5 pr-3">
                  <div className="font-semibold">{r.name}</div>
                  <div className="max-w-[18rem] truncate text-xs text-muted-foreground">
                    {r.detail}
                  </div>
                </td>
                <td className="py-2.5 pr-3 text-muted-foreground">{r.covers}</td>
                <td className="py-2.5 pr-3 text-right font-mono">{r.hitRate.toFixed(1)}%</td>
                <td className="py-2.5 pr-3 text-right font-mono">{signedPct(r.payout, 1)}</td>
                <td
                  className={cn(
                    "py-2.5 pr-3 text-right font-mono text-base font-extrabold",
                    evTone(r.per100),
                  )}
                >
                  {r.per100.toFixed(2)}
                </td>
                <td className="py-2.5 text-right">
                  {r.result && (
                    <button
                      onClick={() => onLoad(r.result!)}
                      className="btn-secondary px-2 py-1 text-xs"
                    >
                      Load
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {single && oneGame && (
        <div className="card border-primary/30 bg-primary/5">
          <div className="mb-2 flex items-center gap-2 text-sm font-bold text-primary">
            <Info className="h-4 w-4" />
            What the table is showing
          </div>
          <ul className="space-y-2 text-sm text-foreground">
            <li>
              <span className="font-semibold">Coverage is a variance dial, not an edge dial.</span>{" "}
              The straight single lands {single.hitRate.toFixed(0)}% of the time and the 1-game
              cover lands {oneGame.hitRate.toFixed(0)}% — completely different bets, and yet their
              expected value is {single.per100.toFixed(2)} against {oneGame.per100.toFixed(2)}.
              Identical, because they are priced in the same market. Covering more scenarios buys
              frequency and sells payout at an exactly fair rate.
            </li>
            {twoGame && (
              <li>
                <span className="font-semibold">Leg count is the dial that moves value.</span> Going
                from one game to two takes expected value from {oneGame.per100.toFixed(2)} to{" "}
                {twoGame.per100.toFixed(2)} per 100 — because the second game multiplies in a second
                bookmaker margin. The 8-of-9 badge looks safer than 2-of-3, but it costs you{" "}
                {(oneGame.per100 - twoGame.per100).toFixed(2)} per 100 staked to own it.
              </li>
            )}
            <li>
              <span className="font-semibold">Best on this board:</span> {best.name} at{" "}
              {best.per100.toFixed(2)} per 100.{" "}
              {best.per100 >= 100
                ? "Above break-even — this is a genuine edge, not a risk preference."
                : "Still below 100, so this is the least bad option rather than a good one."}
            </li>
          </ul>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- markets */

function MarketsTab({ margins, mode }: { margins: MarketMargin[]; mode: ScanMode }) {
  const [maxPct, setMaxPct] = useState("");

  const cap = parseFloat(maxPct);
  const shown = Number.isFinite(cap)
    ? margins.filter((m) => (mode === "cross" ? m.bestPct : m.singlePct) <= cap)
    : margins;

  if (margins.length === 0) {
    return (
      <div className="card text-sm text-muted-foreground">
        Load a scan or demo odds to see market margins.
      </div>
    );
  }

  const key = (m: MarketMargin) => (mode === "cross" ? m.bestPct : m.singlePct);
  const values = margins.map(key).sort((a, b) => a - b);
  const median = values[Math.floor(values.length / 2)];
  const arbs = margins.filter((m) => m.bestPct < 0).length;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Markets" value={String(margins.length)} />
        <StatTile label="Tightest" value={signedPct(values[0])} tone="text-success" />
        <StatTile label="Median" value={signedPct(median)} />
        <StatTile
          label="Below 100%"
          value={String(arbs)}
          tone={arbs > 0 ? "text-success" : undefined}
          hint={arbs > 0 ? "true arbs" : "no free money today"}
        />
      </div>

      <div className="card">
        <div className="mb-3 flex flex-wrap items-end gap-4">
          <div className="w-40">
            <label className="label" htmlFor="test-maxpct">
              Max margin %
            </label>
            <input
              id="test-maxpct"
              value={maxPct}
              onChange={(e) => setMaxPct(e.target.value)}
              placeholder="any"
              inputMode="decimal"
              className="input"
            />
          </div>
          <p className="flex-1 text-xs text-muted-foreground">
            Expected value is <span className="font-mono">100 / S</span>, and S is built from these
            margins. Widening bookmaker coverage is the only lever here that moves the number —
            everything on the other tabs just reshapes risk.
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[38rem] text-sm">
            <thead>
              <tr className="border-b border-border text-left">
                <th className="pb-2 pr-3 font-bold">Match</th>
                <th className="pb-2 pr-3 text-right font-bold">Books</th>
                <th className="pb-2 pr-3 text-right font-bold">Best across books</th>
                <th className="pb-2 text-right font-bold">Tightest single book</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((m) => (
                <tr key={m.game.id} className="border-b border-border/60 last:border-0">
                  <td className="py-2 pr-3">
                    <div className="max-w-[16rem] truncate font-semibold">
                      {m.game.home} v {m.game.away}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {formatDateTimeLocal(m.game.commence)}
                      {m.game.league ? ` · ${m.game.league}` : ""}
                    </div>
                  </td>
                  <td className="py-2 pr-3 text-right font-mono text-muted-foreground">
                    {m.books}
                  </td>
                  <td
                    className={cn(
                      "py-2 pr-3 text-right font-mono font-bold",
                      m.bestPct < 0 ? "text-success" : "text-foreground",
                    )}
                  >
                    {signedPct(m.bestPct)}
                  </td>
                  <td className="py-2 text-right font-mono text-muted-foreground">
                    {signedPct(m.singlePct)}
                    <span className="ml-2 text-xs">{m.singleBook}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {shown.length === 0 && (
          <p className="pt-3 text-sm text-muted-foreground">No market is that tight right now.</p>
        )}
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- ledger */

function LedgerTab() {
  const [bets, setBets] = useState<Bet[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [period, setPeriod] = useState<string>("all");

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("bets")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) setError(error.message);
      else setBets((data ?? []) as Bet[]);
      setLoading(false);
    };
    void load();
  }, []);

  const days = PERIODS.find((p) => p.key === period)?.days ?? null;

  const rows = useMemo(() => {
    return bets
      .filter((b) => withinPeriod(b.created_at, days))
      .map((bet) => {
        const ev = evaluateRows(bet.rows, bet.tax);
        const actual = computeBet(bet);
        return { bet, ev, actual };
      });
  }, [bets, days]);

  const settled = rows.filter((r) => r.actual.settled && r.ev);
  const totals = settled.reduce(
    (acc, r) => ({
      staked: acc.staked + r.actual.totalStaked,
      expected: acc.expected + (r.ev?.expectedProfit ?? 0),
      actual: acc.actual + r.actual.netProfit,
    }),
    { staked: 0, expected: 0, actual: 0 },
  );

  const expectedRoi = totals.staked > 0 ? (totals.expected / totals.staked) * 100 : 0;
  const actualRoi = totals.staked > 0 ? (totals.actual / totals.staked) * 100 : 0;

  if (loading) return <div className="card text-sm text-muted-foreground">Loading bets…</div>;
  if (error) return <Alert tone="error">{error}</Alert>;

  return (
    <div className="space-y-4">
      <div className="card">
        <span className="label">Period</span>
        <div className="inline-flex rounded-lg border border-border bg-card p-1">
          {PERIODS.map((p) => (
            <button
              key={p.key}
              onClick={() => setPeriod(p.key)}
              className={cn(
                "rounded-md px-3 py-1.5 text-xs font-semibold transition",
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

      {settled.length === 0 ? (
        <div className="card text-sm text-muted-foreground">
          No settled bets in this period yet. Once bets are settled in{" "}
          <Link to="/my-bets" className="font-semibold text-primary hover:underline">
            My Bets
          </Link>
          , this compares what each one was mathematically worth when you placed it against what it
          actually returned.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile label="Settled bets" value={String(settled.length)} />
            <StatTile label="Staked" value={fmt(totals.staked)} />
            <StatTile
              label="Expected ROI"
              value={signedPct(expectedRoi, 1)}
              tone={expectedRoi >= 0 ? "text-success" : "text-destructive"}
              hint="what the odds implied"
            />
            <StatTile
              label="Actual ROI"
              value={signedPct(actualRoi, 1)}
              tone={actualRoi >= 0 ? "text-success" : "text-destructive"}
              hint={`${signedPct(actualRoi - expectedRoi, 1)} vs expected`}
            />
          </div>

          <div className="card text-sm">
            <div className="mb-2 flex items-center gap-2 font-bold text-primary">
              <Info className="h-4 w-4" />
              How to read this
            </div>
            <p className="text-muted-foreground">
              Expected ROI is computed from each bet&apos;s own stored odds and stakes — the
              probability-weighted return across every scenario, tax included. It is what the bet
              was worth the moment it was placed, independent of how it happened to land. If actual
              tracks expected over enough bets, the model is sound and the strategy simply bleeds at
              the rate shown. A large gap on {settled.length} bet
              {settled.length === 1 ? "" : "s"} is much more likely to be variance than skill — in
              either direction.
            </p>
          </div>

          <div className="card overflow-x-auto">
            <table className="w-full min-w-[42rem] text-sm">
              <thead>
                <tr className="border-b border-border text-left">
                  <th className="pb-2 pr-3 font-bold">Bet</th>
                  <th className="pb-2 pr-3 text-right font-bold">Staked</th>
                  <th className="pb-2 pr-3 text-right font-bold">Win chance</th>
                  <th className="pb-2 pr-3 text-right font-bold">Expected</th>
                  <th className="pb-2 text-right font-bold">Actual</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ bet, ev, actual }) => (
                  <tr key={bet.id} className="border-b border-border/60 last:border-0">
                    <td className="py-2 pr-3">
                      <div className="max-w-[18rem] truncate font-semibold">
                        {bet.title || "Untitled bet"}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {formatDate(bet.created_at)} · {bet.team_count} event
                        {bet.team_count === 1 ? "" : "s"}
                        {!actual.settled ? " · pending" : ""}
                      </div>
                    </td>
                    <td className="py-2 pr-3 text-right font-mono">{fmt(actual.totalStaked)}</td>
                    <td className="py-2 pr-3 text-right font-mono text-muted-foreground">
                      {ev ? `${(ev.winProb * 100).toFixed(0)}%` : "—"}
                    </td>
                    <td
                      className={cn(
                        "py-2 pr-3 text-right font-mono",
                        ev && ev.expectedProfit >= 0 ? "text-success" : "text-destructive",
                      )}
                    >
                      {ev ? fmt(ev.expectedProfit) : "—"}
                    </td>
                    <td
                      className={cn(
                        "py-2 text-right font-mono font-bold",
                        !actual.settled
                          ? "text-muted-foreground"
                          : actual.netProfit >= 0
                            ? "text-success"
                            : "text-destructive",
                      )}
                    >
                      {actual.settled ? fmt(actual.netProfit) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
