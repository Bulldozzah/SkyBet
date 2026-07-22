import { createFileRoute, useRouterState, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Save, Download, RotateCcw, Scale, Target, Eraser } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { ProtectedRoute } from "@/components/protected-route";
import { useAuth } from "@/lib/auth";
import { supabase, type LoadableBet } from "@/lib/supabase";
import { exportBetPDF } from "@/lib/export-pdf";
import { cn } from "@/lib/utils";
import {
  OUTCOMES,
  OUTCOME_LABELS,
  SPORTS,
  TEAM_LETTERS,
  TEAM_TABS,
  balanceProfitStakes,
  balanceWinStakes,
  computeRows,
  deriveScenarioOdds,
  fmt,
  makeNames,
  makeOutcomeOdds,
  makeRows,
  scenarioOutcomes,
  scenarioTeams,
  sideWord,
  toNumber,
  type OutcomeOddsInput,
  type Row,
  type TeamTab,
} from "@/lib/calculator";

export const Route = createFileRoute("/calculator")({
  head: () => ({
    meta: [
      { title: "Calculator — BetMaster" },
      {
        name: "description",
        content:
          "Split your budget across every scenario. See stakes, returns and coverage in real time.",
      },
      { property: "og:title", content: "Calculator — BetMaster" },
      {
        property: "og:description",
        content: "Cover-betting calculator with equal-profit and target-win balancing.",
      },
    ],
  }),
  component: CalculatorRoute,
});

function CalculatorRoute() {
  return (
    <ProtectedRoute>
      <CalculatorPage />
    </ProtectedRoute>
  );
}

/** Per-tab state: each of the 1/2/3 tabs keeps its own rows, names and odds. */
type ByTeams<T> = Record<number, T>;

const initialRows = (): ByTeams<Row[]> =>
  Object.fromEntries(TEAM_TABS.map((n) => [n, makeRows(n)]));
const initialNames = (): ByTeams<string[]> =>
  Object.fromEntries(TEAM_TABS.map((n) => [n, makeNames(n)]));
const initialOutcomeOdds = (): ByTeams<OutcomeOddsInput[]> =>
  Object.fromEntries(TEAM_TABS.map((n) => [n, makeOutcomeOdds(n)]));

function CalculatorPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  // A bet handed over from Scanner or My Bets arrives as router location state.
  const loadedBet = useRouterState({
    select: (s) => (s.location.state as { loadBet?: LoadableBet } | undefined)?.loadBet,
  });

  const [sport, setSport] = useState(SPORTS[0].id);
  const [tax, setTax] = useState("0.0");
  const [targetStake, setTargetStake] = useState("100");
  const [activeTeams, setActiveTeams] = useState<TeamTab>(2);
  const [rowsByTeams, setRowsByTeams] = useState<ByTeams<Row[]>>(initialRows);
  const [namesByTeams, setNamesByTeams] = useState<ByTeams<string[]>>(initialNames);
  const [outcomeOddsByTeams, setOutcomeOddsByTeams] =
    useState<ByTeams<OutcomeOddsInput[]>>(initialOutcomeOdds);

  const [targetWin, setTargetWin] = useState("");
  const [betTitle, setBetTitle] = useState("");
  const [matchInfo, setMatchInfo] = useState<
    { home: string; away: string; league?: string }[] | null
  >(null);
  const [statusMsg, setStatusMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [selectedRow, setSelectedRow] = useState<number | null>(null);

  const rows = rowsByTeams[activeTeams];
  const teamNames = namesByTeams[activeTeams];
  const sportMeta = SPORTS.find((s) => s.id === sport) ?? SPORTS[0];
  const side = (n: number) => sideWord(sportMeta, n);

  const { totalStake, remaining, results } = useMemo(
    () => computeRows(rows, tax, targetStake),
    [rows, tax, targetStake],
  );

  // ---------------------------------------------------------------- mutators

  const setRows = (updater: (prev: Row[]) => Row[]) => {
    setRowsByTeams((prev) => ({ ...prev, [activeTeams]: updater(prev[activeTeams]) }));
  };

  const updateRow = (index: number, field: "stake" | "odds", value: string) => {
    setRows((prev) => prev.map((row, i) => (i === index ? { ...row, [field]: value } : row)));
  };

  const setTeamName = (index: number, value: string) => {
    setNamesByTeams((prev) => ({
      ...prev,
      [activeTeams]: prev[activeTeams].map((nm, i) => (i === index ? value : nm)),
    }));
  };

  /**
   * 2/3-team tabs: changing one W/D/L input recomputes every scenario's odds
   * as the product of the relevant outcome odds.
   */
  const setOutcomeOdd = (team: number, outcome: "W" | "D" | "L", value: string) => {
    const n = activeTeams;
    const next = outcomeOddsByTeams[n].map((po, t) =>
      t === team ? { ...po, [outcome]: value } : po,
    );
    setOutcomeOddsByTeams((prev) => ({ ...prev, [n]: next }));
    const derived = deriveScenarioOdds(next, n, Math.pow(3, n));
    setRows((prev) => prev.map((row, i) => ({ ...row, odds: derived[i] })));
  };

  const clearOutcomeOdds = () => {
    setOutcomeOddsByTeams((prev) => ({ ...prev, [activeTeams]: makeOutcomeOdds(activeTeams) }));
    setRows((prev) => prev.map((row) => ({ ...row, odds: "0" })));
    setStatusMsg("Odds cleared.");
  };

  const toggleExclude = (index: number) => {
    setRows((prev) =>
      prev.map((row, i) => (i === index ? { ...row, excluded: !row.excluded } : row)),
    );
  };

  /** Bump a losing row's stake by the minimum that makes it break even. */
  const applyMinToCover = (index: number) => {
    const r = results[index];
    if (!r || r.minToCover == null) return;
    const newStake = toNumber(rows[index].stake) + r.minToCover;
    updateRow(index, "stake", String(Math.ceil(newStake * 100) / 100));
  };

  const resetAll = () => {
    setTax("0.0");
    setTargetStake("100");
    setRowsByTeams(initialRows());
    setNamesByTeams(initialNames());
    setOutcomeOddsByTeams(initialOutcomeOdds());
    setBetTitle("");
    setMatchInfo(null);
    setSelectedRow(null);
    setTargetWin("");
    setStatusMsg("Reset to defaults.");
  };

  // -------------------------------------------------------------- balancing

  const balanceProfit = () => {
    const stakes = balanceProfitStakes(rows, tax, targetStake);
    if (!stakes) {
      setStatusMsg(
        "Nothing to balance — set a budget and at least one scenario with odds above 1.",
      );
      return;
    }
    setRows((prev) => prev.map((row, i) => ({ ...row, stake: String(stakes[i]) })));
    setStatusMsg("Balanced: profit is now spread evenly across included scenarios.");
  };

  const balanceWin = () => {
    const res = balanceWinStakes(rows, targetStake, targetWin);
    if (!res.ok) {
      setStatusMsg(res.message);
      return;
    }
    setRows((prev) => prev.map((row, i) => ({ ...row, stake: String(res.stakes[i]) })));
    setStatusMsg(
      `Balanced Total win at ${fmt(toNumber(targetWin))} — staked ${fmt(res.total)}, remaining ${fmt(res.remaining)}.`,
    );
  };

  // ------------------------------------------------------- load / save / pdf

  useEffect(() => {
    if (!loadedBet) return;
    const bet = loadedBet;
    const count = bet.team_count as TeamTab;
    setActiveTeams(count);
    setTax(String(bet.tax));
    setTargetStake(String(bet.target_stake));
    setRowsByTeams((prev) => ({ ...prev, [count]: bet.rows }));
    setNamesByTeams((prev) => ({
      ...prev,
      [count]:
        Array.isArray(bet.team_names) && bet.team_names.length === count
          ? bet.team_names
          : makeNames(count),
    }));
    // Scanner picks carry each event's individual W/D/L odds; saved bets don't,
    // so those inputs fall back to blank there.
    setOutcomeOddsByTeams((prev) => ({
      ...prev,
      [count]:
        Array.isArray(bet.outcome_odds) && bet.outcome_odds.length === count
          ? bet.outcome_odds.map((o) => ({ W: o?.W ?? "", D: o?.D ?? "", L: o?.L ?? "" }))
          : makeOutcomeOdds(count),
    }));
    setBetTitle(bet.title || "");
    setMatchInfo(Array.isArray(bet.games) && bet.games.length > 0 ? bet.games : null);
    setStatusMsg(`Loaded "${bet.title}".`);
    // Clear the one-shot hand-off so a refresh doesn't reload it.
    void navigate({ to: "/calculator", replace: true, state: {} as never });
  }, [loadedBet, navigate]);

  const saveBet = async () => {
    if (!user) return;
    setBusy(true);
    setStatusMsg("");
    const { error } = await supabase.from("bets").insert({
      user_id: user.id,
      title:
        betTitle ||
        `${sportMeta.label} · ${activeTeams} ${side(activeTeams).toLowerCase()} · ${new Date().toLocaleString()}`,
      team_count: activeTeams,
      tax: toNumber(tax),
      target_stake: toNumber(targetStake),
      rows,
      team_names: teamNames,
    });
    setBusy(false);
    if (error) {
      setStatusMsg(`Save failed: ${error.message}`);
    } else {
      setStatusMsg("Bet saved. View it under “My Bets”.");
      setBetTitle("");
    }
  };

  const exportPDF = () => {
    exportBetPDF({
      sport: sportMeta,
      activeTeams,
      rows,
      results,
      teamNames,
      tax,
      targetStake,
      totalStake,
      betTitle,
    });
  };

  const matchInfoText =
    matchInfo &&
    matchInfo.map((g) => `${g.home} v ${g.away}${g.league ? ` (${g.league})` : ""}`).join("  +  ");

  // ------------------------------------------------------------------ render

  return (
    <AppShell>
      {/* Header */}
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold md:text-3xl">Calculator</h1>
          <p className="text-sm text-muted-foreground">
            {sportMeta.label} · {activeTeams} {side(activeTeams).toLowerCase()} · {rows.length}{" "}
            outcome combinations · tax &amp; coverage check
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={resetAll} className="btn-secondary">
            <RotateCcw className="h-4 w-4" /> Reset
          </button>
          <button onClick={exportPDF} className="btn-secondary">
            <Download className="h-4 w-4" /> Export PDF
          </button>
          <button
            onClick={() => void saveBet()}
            disabled={busy}
            className="btn-primary disabled:opacity-60"
          >
            <Save className="h-4 w-4" /> {busy ? "Saving…" : "Save bet"}
          </button>
        </div>
      </div>

      {/*
        Two columns on desktop: controls on the left, scenario table on the
        right. Below `lg` the grid collapses to one column and DOM order puts
        the controls on top with the table beneath.
      */}
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(300px,360px)_minmax(0,1fr)]">
        {/* ------------------------------------------------ controls column */}
        <aside className="space-y-4 lg:sticky lg:top-4">
          {/* Sport / budget / tax */}
          <div className="card space-y-3">
            <div>
              <label className="label" htmlFor="sport">
                <span className="mr-1">{sportMeta.icon}</span> Sport
              </label>
              <select
                id="sport"
                value={sport}
                onChange={(e) => setSport(e.target.value)}
                className="input"
              >
                {SPORTS.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.icon} {s.label}
                  </option>
                ))}
              </select>
            </div>

            {/*
              Live totals. Read-only, so they sit on the muted surface to
              separate them from the editable fields underneath.
            */}
            <div
              aria-live="polite"
              className="grid grid-cols-2 gap-3 rounded-md bg-secondary px-3 py-2"
            >
              <div>
                <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Total stake
                </div>
                <div className="mt-0.5 text-xl font-bold">{fmt(totalStake)}</div>
              </div>
              <div>
                <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Remaining
                </div>
                <div
                  className={cn(
                    "mt-0.5 text-xl font-bold",
                    remaining < 0 ? "text-destructive" : "text-success",
                  )}
                >
                  {fmt(remaining)}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label" htmlFor="budget">
                  Budget (stake)
                </label>
                <input
                  id="budget"
                  type="number"
                  step="1"
                  value={targetStake}
                  onChange={(e) => setTargetStake(e.target.value)}
                  className="input"
                />
              </div>
              <div>
                <label className="label" htmlFor="tax">
                  Tax rate
                </label>
                <input
                  id="tax"
                  type="number"
                  step="0.01"
                  value={tax}
                  onChange={(e) => setTax(e.target.value)}
                  className="input"
                />
              </div>
            </div>
          </div>

          {/* Event-count tabs */}
          <div className="flex rounded-lg border border-border bg-card p-1" role="tablist">
            {TEAM_TABS.map((n) => (
              <button
                key={n}
                role="tab"
                aria-selected={activeTeams === n}
                onClick={() => {
                  setActiveTeams(n);
                  setSelectedRow(null);
                }}
                className={cn(
                  "flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-2 text-sm font-medium transition",
                  activeTeams === n
                    ? "bg-primary text-primary-foreground"
                    : "text-foreground hover:bg-accent",
                )}
              >
                {n} {side(n)}
                <span
                  className={cn(
                    "rounded-full px-1.5 py-0.5 text-xs",
                    activeTeams === n ? "bg-white/20" : "bg-secondary",
                  )}
                >
                  {Math.pow(3, n)}
                </span>
              </button>
            ))}
          </div>

          {/* Participants & odds */}
          <div className="card">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="font-semibold">{side(2)} &amp; odds</h2>
              <button
                onClick={clearOutcomeOdds}
                className="btn-ghost text-xs"
                title="Clear the W/D/L inputs and reset all scenario odds"
              >
                <Eraser className="h-3.5 w-3.5" /> Clear odds
              </button>
            </div>

            <div className="space-y-3">
              {Array.from({ length: activeTeams }).map((_, t) => {
                // 1-event tab: rows are AW, AD, AL in OUTCOMES order, so input k
                // binds straight to rows[k].odds. 2/3-event tabs use the derived
                // per-participant inputs instead.
                const oneEvent = activeTeams === 1;
                const po = outcomeOddsByTeams[activeTeams][t];
                return (
                  // Name on its own row, W/D/L beneath — the controls column is
                  // too narrow to keep all five fields on one line.
                  <div key={TEAM_LETTERS[t]} className="space-y-2">
                    <div className="flex items-center gap-2">
                      <div className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-primary/10 text-sm font-bold text-primary">
                        {TEAM_LETTERS[t]}
                      </div>
                      <input
                        value={teamNames[t] ?? ""}
                        onChange={(e) => setTeamName(t, e.target.value)}
                        placeholder={`${sportMeta.side} ${TEAM_LETTERS[t]} name`}
                        className="input"
                      />
                    </div>
                    <div className="grid grid-cols-3 gap-2 pl-11">
                      {OUTCOMES.map((o, k) => (
                        <label
                          key={o}
                          className="relative block"
                          title={`Odds for ${OUTCOME_LABELS[o]}`}
                        >
                          <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-xs font-semibold text-muted-foreground">
                            {o}
                          </span>
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            value={oneEvent ? rows[k].odds : po[o]}
                            onChange={(e) =>
                              oneEvent
                                ? updateRow(k, "odds", e.target.value)
                                : setOutcomeOdd(t, o, e.target.value)
                            }
                            className="input pl-7 text-right"
                          />
                        </label>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Balancing */}
          <div className="card space-y-3">
            <h2 className="font-semibold">Balancing</h2>
            <button
              onClick={balanceProfit}
              className="btn-primary w-full justify-center"
              title="Redistribute the budget so every included scenario has the same profit"
            >
              <Scale className="h-4 w-4" /> Balance (equal profit)
            </button>
            <div className="flex items-center gap-2">
              <button
                onClick={balanceWin}
                className="btn-secondary shrink-0"
                title="Set every included scenario's Total win to this amount — the excess budget stays in Remaining"
              >
                <Target className="h-4 w-4" /> Balance win
              </button>
              <input
                type="number"
                min="0"
                step="1"
                placeholder="Total win"
                value={targetWin}
                onChange={(e) => setTargetWin(e.target.value)}
                className="input"
              />
            </div>
          </div>

          {/* Save name */}
          <div className="card">
            <label className="label" htmlFor="betTitle">
              Bet name
            </label>
            <input
              id="betTitle"
              type="text"
              placeholder="Defaults to date &amp; time"
              value={betTitle}
              onChange={(e) => setBetTitle(e.target.value)}
              className="input"
            />
          </div>

          {statusMsg && (
            <div
              aria-live="polite"
              className="rounded-md border border-border bg-secondary px-3 py-2 text-sm text-secondary-foreground"
            >
              {statusMsg}
            </div>
          )}
        </aside>

        {/* ------------------------------------------- scenario table column */}
        <section className="card overflow-hidden p-0">
          {matchInfoText && (
            <div className="border-b border-border bg-secondary/60 px-3 py-2 text-xs text-muted-foreground">
              {matchInfoText}
            </div>
          )}
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
                  <th className="p-3 text-left">Min to cover</th>
                  <th className="p-3 text-right">Profit %</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => {
                  const r = results[i];
                  return (
                    <tr
                      key={row.name}
                      onClick={() => setSelectedRow((prev) => (prev === i ? null : i))}
                      className={cn(
                        "border-t border-border transition-colors",
                        row.excluded && "opacity-40",
                        selectedRow === i && "bg-accent/60",
                      )}
                    >
                      <td className="p-3">
                        <input
                          type="checkbox"
                          checked={!row.excluded}
                          title={
                            row.excluded
                              ? "Excluded from balancing — click to include"
                              : "Included in balancing — click to exclude"
                          }
                          onClick={(e) => e.stopPropagation()}
                          onChange={() => toggleExclude(i)}
                          className="h-4 w-4 accent-primary"
                        />
                      </td>
                      <td className="p-3">
                        <div className="text-xs text-muted-foreground">
                          {scenarioTeams(row.name, teamNames)}
                        </div>
                        <div className="font-mono text-sm font-semibold">
                          {scenarioOutcomes(row.name)}
                        </div>
                      </td>
                      <td className="p-3 text-right">
                        <input
                          type="number"
                          step="0.01"
                          value={row.stake}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => updateRow(i, "stake", e.target.value)}
                          className="input w-24 text-right"
                        />
                      </td>
                      <td className="p-3 text-right">
                        <input
                          type="number"
                          step="0.01"
                          value={row.odds}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => updateRow(i, "odds", e.target.value)}
                          className="input w-20 text-right"
                        />
                      </td>
                      <td className="p-3 text-right font-mono">{fmt(r.gross)}</td>
                      <td
                        className={cn(
                          "p-3 text-right font-mono font-semibold",
                          r.profit >= 0 ? "text-success" : "text-destructive",
                        )}
                      >
                        {r.profit >= 0 ? "+" : ""}
                        {fmt(r.profit)}
                      </td>
                      <td className="p-3 text-center">
                        <span
                          title={r.covered ? "Covered" : "Loss"}
                          className={cn(
                            "text-base font-bold",
                            r.covered ? "text-success" : "text-destructive",
                          )}
                        >
                          {r.covered ? "▲" : "▼"}
                        </span>
                      </td>
                      <td className="p-3">
                        {r.covered ? (
                          <span className="text-xs text-muted-foreground">—</span>
                        ) : r.minToCover === null ? (
                          <span
                            className="text-xs text-muted-foreground"
                            title="Odds ≤ 1 can never cover the stake"
                          >
                            n/a
                          </span>
                        ) : (
                          <button
                            type="button"
                            title={
                              r.affordable
                                ? `Click to stake +${fmt(r.minToCover)} (within Remaining)`
                                : `Needs +${fmt(r.minToCover)} — exceeds Remaining`
                            }
                            onClick={(e) => {
                              e.stopPropagation();
                              applyMinToCover(i);
                            }}
                            className={cn(
                              "rounded-full px-2 py-1 text-xs font-semibold transition",
                              r.affordable
                                ? "bg-success/15 text-success hover:bg-success/25"
                                : "bg-warning/20 text-warning-foreground hover:bg-warning/30",
                            )}
                          >
                            +{fmt(r.minToCover)}
                          </button>
                        )}
                      </td>
                      <td
                        className={cn(
                          "p-3 text-right font-mono",
                          r.profit >= 0 ? "text-success" : "text-destructive",
                        )}
                      >
                        {r.gross > 0 ? `${r.profitPct.toFixed(1)}%` : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </AppShell>
  );
}
