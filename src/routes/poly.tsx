// Poly — the prediction-market desk: Kalshi and Polymarket prices scanned with
// the same maths as the Scanner, plus a value ranking in the Test workbench's
// style, and a contract-slip calculator that speaks the venues' own language
// (cents and contracts rather than stakes and odds).
//
// The prices arrive through the existing odds proxy as ordinary bookmakers
// (bookmaker keys `kalshi,polymarket`), so a scan costs 1 credit per selected
// league from the same shared quota as the Scanner. Multiple leagues merge into
// one board — combos and rankings pair across them, like the Scanner's date
// scan — and a venue filter narrows the board to prices placeable at one
// account. What placement means differs by shape:
//   - single-game plays are standing order-book contracts, placeable as quoted;
//   - multi-game combos are RFQ-quoted parlays at ONE venue, so scanned prices
//     are estimates and the slip shows the max quote worth accepting.

import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Coins, Radar, Scale, ArrowRight, ReceiptText, AlertTriangle, Zap } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { ProtectedRoute } from "@/components/protected-route";
import { Alert } from "@/components/auth-shell";
import { ContractSlipModal } from "@/components/contract-slip";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import {
  fetchLeagueOdds,
  fetchSoccerLeagues,
  fetchOddsConfigured,
  type Game,
  type League,
} from "@/lib/odds-api";
import {
  scanCombos,
  evalSingleGameArb,
  buildComboBet,
  buildArbBet,
  excludePatternKey,
  exclPatternOptions,
  OUTCOMES,
  type ComboResult,
  type ArbResult,
  type ScannerBet,
} from "@/lib/scanner";
import {
  expectedPer100,
  marketMargin,
  correlationNote,
  matchesExclFilter,
  signedPct,
} from "@/lib/edge";
import {
  EXCHANGE_BOOKMAKERS,
  EXCHANGE_REGION,
  applyKalshiFees,
  getPolyDemoGames,
  toCents,
  fmtCents,
} from "@/lib/poly";
import { formatDateTime } from "@/lib/format-date";

export const Route = createFileRoute("/poly")({
  head: () => ({
    meta: [
      { title: "Poly — BetMaster" },
      {
        name: "description",
        content:
          "Kalshi and Polymarket prices scanned for venue arbs and covers, ranked by expected value, with an exchange-native contract slip.",
      },
      { property: "og:title", content: "Poly — BetMaster" },
      {
        property: "og:description",
        content: "Prediction-market scanner and value ranking over exchange prices.",
      },
    ],
  }),
  component: PolyRoute,
});

function PolyRoute() {
  return (
    <ProtectedRoute>
      <PolyPage />
    </ProtectedRoute>
  );
}

const TABS = [
  {
    key: "scan",
    label: "Exchange scanner",
    icon: Radar,
    blurb: "Venue arbs on single games, and one-venue combo covers over the scanned prices.",
  },
  {
    key: "value",
    label: "Value ranking",
    icon: Scale,
    blurb: "Every structure ranked by what it is worth, exactly as the Test workbench does.",
  },
] as const;

type TabKey = (typeof TABS)[number]["key"];

// Which venue's prices to work from. "both" is the default and the only mode
// where cross-venue arbs exist; a single venue answers "what could I place if
// I only hold an account there".
type VenueKey = "both" | "polymarket" | "kalshi";

const VENUES: [VenueKey, string][] = [
  ["both", "Both venues"],
  ["polymarket", "Polymarket"],
  ["kalshi", "Kalshi"],
];

// Exchange scans are small (two venues, majors only), so a modest pool keeps
// C(n,3) in check without hiding anything that matters.
const POOL = 12;
const MAX_ROWS = 30;
const MAX_GAMES = 20;

const CACHE_KEY = "poly-cache";

interface PolyCache {
  /** Pre-multi-league cache shape; read once for migration, never written. */
  league?: string;
  selLeagues?: string[];
  venue?: VenueKey;
  games?: Game[] | null;
  source?: string;
  scannedAt?: number | null;
  credits?: number | string | null;
  minPct?: string;
  teamCount?: number;
  legCount?: number;
  feeAdj?: boolean;
}

const loadCache = (): PolyCache => {
  if (typeof window === "undefined") return {};
  try {
    return (JSON.parse(localStorage.getItem(CACHE_KEY) ?? "null") as PolyCache) || {};
  } catch {
    return {};
  }
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

function PolyPage() {
  const navigate = useNavigate();
  const { session } = useAuth();
  const token = session?.access_token ?? "";

  const [tab, setTab] = useState<TabKey>("scan");
  const [hasKey, setHasKey] = useState(false);
  const [leagues, setLeagues] = useState<League[]>([]);
  const [selLeagues, setSelLeagues] = useState<string[]>(["soccer_epl"]);
  const [venue, setVenue] = useState<VenueKey>("both");
  const [games, setGames] = useState<Game[] | null>(null);
  const [source, setSource] = useState(""); // 'live' | 'demo'
  const [scannedAt, setScannedAt] = useState<number | null>(null);
  const [credits, setCredits] = useState<number | string | null>(null);
  const [servedFromCache, setServedFromCache] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Kalshi's trading fee lives on the trade, not the winnings, so it has to be
  // priced into the odds before any scanning maths runs. On by default: a thin
  // edge that dies to fees is not an edge.
  const [feeAdj, setFeeAdj] = useState(true);
  const [minPct, setMinPct] = useState("0");
  const [teamCount, setTeamCount] = useState(2);
  const [legCount, setLegCount] = useState(1);
  const [exclFilter, setExclFilter] = useState<string[]>([]);
  // The pick open in the contract-slip modal (null = closed).
  const [slip, setSlip] = useState<{
    build: (budget: number) => ScannerBet;
    bookLabel: string;
  } | null>(null);
  const [hydrated, setHydrated] = useState(false);

  // Restore after mount — localStorage is browser-only, so reading it in a
  // state initializer would desync hydration.
  useEffect(() => {
    const c = loadCache();
    if (c.selLeagues) setSelLeagues(c.selLeagues);
    else if (c.league) setSelLeagues([c.league]);
    if (c.venue) setVenue(c.venue);
    if (c.games) setGames(c.games);
    if (c.source) setSource(c.source);
    if (c.scannedAt) setScannedAt(c.scannedAt);
    if (c.credits != null) setCredits(c.credits);
    if (c.minPct) setMinPct(c.minPct);
    if (c.teamCount) setTeamCount(c.teamCount);
    if (c.legCount) setLegCount(c.legCount);
    if (typeof c.feeAdj === "boolean") setFeeAdj(c.feeAdj);
    setHydrated(true);
  }, []);

  useEffect(() => {
    fetchOddsConfigured()
      .then(setHasKey)
      .catch(() => setHasKey(false));
  }, []);

  useEffect(() => {
    if (!hasKey || !token) return;
    fetchSoccerLeagues(token)
      .then((ls) => {
        setLeagues(ls);
        // Drop cached selections that are no longer in season.
        setSelLeagues((cur) => {
          const valid = cur.filter((k) => ls.some((l) => l.key === k));
          return valid.length > 0 ? valid : ls.length ? [ls[0].key] : cur;
        });
      })
      .catch((e: Error) => setError(`Could not load leagues: ${e.message}`));
  }, [hasKey, token]);

  useEffect(() => {
    if (!hydrated || !games) return;
    try {
      localStorage.setItem(
        CACHE_KEY,
        JSON.stringify({
          selLeagues,
          venue,
          games,
          source,
          scannedAt,
          credits,
          minPct,
          teamCount,
          legCount,
          feeAdj,
        } satisfies PolyCache),
      );
    } catch {
      // Quota/serialization failures just mean no cache — never break the page.
    }
  }, [
    hydrated,
    selLeagues,
    venue,
    games,
    source,
    scannedAt,
    credits,
    minPct,
    teamCount,
    legCount,
    feeAdj,
  ]);

  /**
   * Fetch every selected league, tag each game with its league title, and
   * merge — combos and rankings then work across leagues, exactly like the
   * Scanner's date scan. One credit per league.
   */
  const scanLive = async () => {
    if (selLeagues.length === 0) {
      setError("Select at least one league to scan.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const settled = await Promise.allSettled(
        selLeagues.map((k) => fetchLeagueOdds(token, k, EXCHANGE_REGION, EXCHANGE_BOOKMAKERS)),
      );
      const merged: Game[] = [];
      const failed: string[] = [];
      let remaining: number | null = null;
      let allCached = true;
      settled.forEach((r, i) => {
        const title = leagues.find((l) => l.key === selLeagues[i])?.title || selLeagues[i];
        if (r.status === "fulfilled") {
          if (!r.value.cached) allCached = false;
          merged.push(...r.value.games.map((g) => ({ ...g, league: title })));
          const rem = parseFloat(String(r.value.remaining));
          // Requests run in parallel; the smallest counter is the freshest.
          if (!Number.isNaN(rem)) remaining = remaining == null ? rem : Math.min(remaining, rem);
        } else {
          failed.push(title);
        }
      });
      const upcoming = merged
        .sort((a, b) => +new Date(a.commence) - +new Date(b.commence))
        .slice(0, MAX_GAMES);
      setGames(upcoming);
      setSource("live");
      if (remaining != null) setCredits(remaining);
      setServedFromCache(allCached && settled.some((r) => r.status === "fulfilled"));
      setScannedAt(Date.now());
      if (failed.length > 0) {
        setError(`Could not fetch: ${failed.join(", ")}. Results cover the leagues that worked.`);
      } else if (upcoming.length === 0) {
        setError(
          "No fixtures with three-way exchange contracts in the selected leagues right now. The venues only carry draw contracts on bigger fixtures — try the majors.",
        );
      }
    } catch (e) {
      setError(`Scan failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const scanDemo = () => {
    setError("");
    setGames(getPolyDemoGames());
    setSource("demo");
    setScannedAt(Date.now());
  };

  // Everything downstream sees the venue filter and fee-adjusted odds, so
  // arbs, combos and rankings all agree on what a price really costs.
  const effGames = useMemo(() => {
    if (!games) return null;
    const byVenue =
      venue === "both"
        ? games
        : games
            .map((g) => ({ ...g, books: g.books.filter((b) => b.key === venue) }))
            .filter((g) => g.books.length > 0);
    return feeAdj ? applyKalshiFees(byVenue) : byVenue;
  }, [games, venue, feeAdj]);

  // Tightest markets first, and the pool every combo scan runs over.
  const pool = useMemo(() => {
    if (!effGames) return [];
    return effGames
      .map((g) => marketMargin(g))
      .filter((m) => m !== null)
      .sort((a, b) => a.bestPct - b.bestPct)
      .slice(0, POOL)
      .map((m) => m.game);
  }, [effGames]);

  const floor = Math.max(0, parseFloat(minPct) || 0);

  const toggleLeague = (key: string) =>
    setSelLeagues((cur) => (cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key]));

  const openInCalculator = (bet: ScannerBet) =>
    navigate({ to: "/calculator", state: { loadBet: bet } as never });

  const openComboSlip = (result: ComboResult) =>
    setSlip({ build: (b) => buildComboBet(result, b), bookLabel: result.bookLabel });

  const openArbSlip = (arb: ArbResult) =>
    setSlip({
      build: (b) => buildArbBet(arb, b),
      bookLabel: [...new Set(Object.values(arb.books))].join(" · "),
    });

  // Pattern keys are structure-specific, so a stale selection from the
  // previous size would silently hide everything on screen.
  const changeLegCount = (n: number) => {
    setLegCount(n);
    setExclFilter([]);
  };

  const active = TABS.find((t) => t.key === tab)!;

  return (
    <AppShell>
      <div className="mb-6">
        <h1 className="flex items-center gap-2 text-2xl font-extrabold text-foreground">
          <Coins className="h-6 w-6 text-primary" />
          Poly
        </h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Kalshi and Polymarket priced with the Scanner&apos;s maths. Exchange prices are
          top-of-book: single contracts are placeable as shown, multi-leg combos are RFQ-quoted at
          the venue, so treat those as estimates to verify. A scan costs 1 credit per selected
          league from the shared quota.
        </p>
      </div>

      {/* Data bar */}
      <div className="card mb-6">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <span className="label">Venue</span>
            <div className="inline-flex rounded-lg border border-border bg-card p-1">
              {VENUES.map(([k, label]) => (
                <button
                  key={k}
                  onClick={() => setVenue(k)}
                  className={cn(
                    "rounded-md px-3 py-1.5 text-xs font-semibold transition",
                    venue === k
                      ? "bg-primary text-primary-foreground"
                      : "text-foreground hover:bg-accent",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <button
            onClick={() => void scanLive()}
            disabled={!hasKey || !token || busy || selLeagues.length === 0}
            className="btn-primary text-xs"
            title={!hasKey ? "The odds API key is not configured on the server" : undefined}
          >
            <Zap className="h-3.5 w-3.5" />
            {busy
              ? "Scanning…"
              : `Scan exchanges (${selLeagues.length} credit${selLeagues.length === 1 ? "" : "s"})`}
          </button>

          <button onClick={scanDemo} className="btn-secondary text-xs">
            Load demo odds
          </button>

          <label className="flex items-center gap-2 pb-2 text-xs font-semibold">
            <input type="checkbox" checked={feeAdj} onChange={(e) => setFeeAdj(e.target.checked)} />
            Price in Kalshi fees
          </label>
        </div>

        {/* League multi-select — combos and rankings pair across leagues. */}
        <div className="mt-3">
          <span className="label">
            Leagues ({selLeagues.length} selected · 1 credit each per scan)
          </span>
          {leagues.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              {hasKey
                ? "The league list loads once you are signed in and approved."
                : "Live scanning needs the server-side odds API key — demo odds work without it."}
            </p>
          ) : (
            <div className="flex max-h-44 flex-wrap gap-2 overflow-y-auto rounded-md border border-border p-2">
              {leagues.map((l) => (
                <label
                  key={l.key}
                  className={cn(
                    "cursor-pointer rounded-full border px-3 py-1 text-xs font-medium transition",
                    selLeagues.includes(l.key)
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-card hover:bg-accent",
                  )}
                >
                  <input
                    type="checkbox"
                    checked={selLeagues.includes(l.key)}
                    onChange={() => toggleLeague(l.key)}
                    className="sr-only"
                  />
                  {l.title}
                </label>
              ))}
            </div>
          )}
        </div>

        <div className="mt-3 text-xs text-muted-foreground">
          {games ? (
            <>
              {source === "demo" ? "Demo data" : "Live exchange prices"} · {games.length} fixture
              {games.length === 1 ? "" : "s"}
              {scannedAt ? ` · ${formatDateTime(scannedAt)}` : ""}
              {source === "live" && servedFromCache ? " · served from shared cache, 0 credits" : ""}
              {credits != null ? ` · ${credits} credits left` : ""}
            </>
          ) : (
            <>
              Nothing scanned yet. Scan a league, or load demo odds to explore. The Scanner&apos;s
              cache is bookmaker prices, not exchange prices, so this page fetches its own —{" "}
              <Link to="/scanner" className="font-semibold text-primary hover:underline">
                Scanner
              </Link>{" "}
              stays untouched.
            </>
          )}
        </div>

        {error && (
          <div className="mt-3">
            <Alert tone="error">{error}</Alert>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-6 lg:flex-row">
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

          {tab === "scan" && (
            <ScanTab
              games={effGames}
              pool={pool}
              floor={floor}
              minPct={minPct}
              setMinPct={setMinPct}
              teamCount={teamCount}
              setTeamCount={setTeamCount}
              onArbSlip={openArbSlip}
              onComboSlip={openComboSlip}
              onLoad={openInCalculator}
            />
          )}
          {tab === "value" && (
            <ValueTab
              pool={pool}
              hasGames={!!effGames}
              floor={floor}
              minPct={minPct}
              setMinPct={setMinPct}
              legCount={legCount}
              setLegCount={changeLegCount}
              exclFilter={exclFilter}
              setExclFilter={setExclFilter}
              onSlip={openComboSlip}
              onLoad={openInCalculator}
            />
          )}
        </div>
      </div>

      {slip && (
        <ContractSlipModal
          build={slip.build}
          bookLabel={slip.bookLabel}
          onClose={() => setSlip(null)}
          onLoad={(bet) => {
            setSlip(null);
            void openInCalculator(bet);
          }}
        />
      )}
    </AppShell>
  );
}

/* ------------------------------------------------------------------- scan */

function ScanTab({
  games,
  pool,
  floor,
  minPct,
  setMinPct,
  teamCount,
  setTeamCount,
  onArbSlip,
  onComboSlip,
  onLoad,
}: {
  games: Game[] | null;
  pool: Game[];
  floor: number;
  minPct: string;
  setMinPct: (v: string) => void;
  teamCount: number;
  setTeamCount: (n: number) => void;
  onArbSlip: (a: ArbResult) => void;
  onComboSlip: (r: ComboResult) => void;
  onLoad: (bet: ScannerBet) => void;
}) {
  // Every game's cross-venue dutch, best first — near-misses stay visible so
  // an empty arb day still shows how close the venues run.
  const arbs = useMemo(() => {
    if (!games) return [];
    return games
      .map((g) => evalSingleGameArb(g, -100))
      .filter((a) => a !== null)
      .sort((a, b) => b.profitPct - a.profitPct)
      .slice(0, 10);
  }, [games]);

  const combos = useMemo(
    () =>
      (pool.length >= teamCount ? scanCombos(pool, "single", floor, teamCount) : []).slice(
        0,
        MAX_ROWS,
      ),
    [pool, floor, teamCount],
  );

  if (!games) {
    return (
      <div className="card text-sm text-muted-foreground">
        Scan a league or load demo odds to see exchange plays.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Single-game venue arbs */}
      <div className="card">
        <h2 className="mb-1 text-sm font-bold">Single-game venue arbs</h2>
        <p className="mb-3 text-xs text-muted-foreground">
          Dutch W/D/L at the best price the venue filter allows — three separate contracts,
          placeable as quoted. Positive margin means the prices sum under 100¢: free money until the
          books move.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[42rem] text-sm">
            <thead>
              <tr className="border-b border-border text-left">
                <th className="pb-2 pr-3 font-bold">Match</th>
                <th className="pb-2 pr-3 font-bold">Best prices</th>
                <th className="pb-2 pr-3 text-right font-bold">Margin</th>
                <th className="pb-2" />
              </tr>
            </thead>
            <tbody>
              {arbs.map((a) => (
                <tr key={a.game.id} className="border-b border-border/60 last:border-0">
                  <td className="py-2.5 pr-3">
                    <div className="max-w-[14rem] truncate font-semibold">
                      {a.game.home} v {a.game.away}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {formatDateTime(a.game.commence)}
                      {a.game.league ? ` · ${a.game.league}` : ""}
                    </div>
                  </td>
                  <td className="py-2.5 pr-3">
                    <div className="flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-xs">
                      {OUTCOMES.map((o) => (
                        <span key={o}>
                          <span className="font-bold">{o}</span> {fmtCents(toCents(a.odds[o]))}{" "}
                          <span className="text-muted-foreground">{a.books[o]}</span>
                        </span>
                      ))}
                    </div>
                  </td>
                  <td
                    className={cn(
                      "py-2.5 pr-3 text-right font-mono font-bold",
                      a.profitPct > 0 ? "text-success" : "text-muted-foreground",
                    )}
                  >
                    {signedPct(a.profitPct)}
                    {a.profitPct > 0 && (
                      <span className="ml-2 rounded bg-success px-1.5 py-0.5 text-xs text-white">
                        ARB
                      </span>
                    )}
                  </td>
                  <td className="py-2.5 text-right">
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => onArbSlip(a)}
                        className="btn-secondary px-2 py-1 text-xs"
                      >
                        <ReceiptText className="h-3.5 w-3.5" /> Slip
                      </button>
                      <button
                        onClick={() => onLoad(buildArbBet(a))}
                        className="btn-secondary px-2 py-1 text-xs"
                      >
                        Load
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Combo covers */}
      <div className="card">
        <div className="mb-3 flex flex-wrap items-end gap-4">
          <div>
            <h2 className="text-sm font-bold">Combo covers — one venue, RFQ-quoted</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Scenario parlays carried by a single venue, safest exclusion first. Prices are
              products of top-of-book legs — an estimate of the RFQ quote, not a bookable number.
              The slip shows the max quote worth accepting per scenario.
            </p>
          </div>
          <div>
            <label className="label" htmlFor="poly-teams">
              Games
            </label>
            <select
              id="poly-teams"
              value={teamCount}
              onChange={(e) => setTeamCount(Number(e.target.value))}
              className="input w-auto"
            >
              {[2, 3].map((n) => (
                <option key={n} value={n}>
                  {n} games ({Math.pow(3, n) - 1} of {Math.pow(3, n)})
                </option>
              ))}
            </select>
          </div>
          <div className="w-28">
            <label className="label" htmlFor="poly-minpct">
              Min profit %
            </label>
            <input
              id="poly-minpct"
              value={minPct}
              onChange={(e) => setMinPct(e.target.value)}
              inputMode="decimal"
              className="input"
            />
          </div>
        </div>

        {combos.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing clears {floor}% with one venue carrying all {teamCount} games. Exchanges list
            far fewer fixtures than bookmakers, so this is the normal case — the value tab shows
            what the board is worth anyway.
          </p>
        ) : (
          <div className="space-y-3">
            {combos.map((r, i) => (
              <div
                key={`${r.games.map((g) => g.id).join("-")}-${r.bookLabel}-${i}`}
                className="rounded-lg border border-border p-3"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="mb-1 flex flex-wrap items-center gap-2">
                      <span className="rounded bg-secondary px-2 py-0.5 text-xs font-bold text-secondary-foreground">
                        via {r.bookLabel}
                      </span>
                      <span className="rounded bg-warning/15 px-2 py-0.5 text-xs font-semibold text-warning">
                        RFQ estimate
                      </span>
                    </div>
                    {r.games.map((g) => (
                      <div key={g.id} className="truncate text-sm font-semibold">
                        {g.home} v {g.away}
                        <span className="ml-2 text-xs font-normal text-muted-foreground">
                          {formatDateTime(g.commence)}
                          {g.league ? ` · ${g.league}` : ""}
                        </span>
                      </div>
                    ))}
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <button onClick={() => onComboSlip(r)} className="btn-secondary py-1.5 text-xs">
                      <ReceiptText className="h-3.5 w-3.5" /> Slip
                    </button>
                    <button
                      onClick={() => onLoad(buildComboBet(r))}
                      className="btn-primary py-1.5 text-xs"
                    >
                      Load into Calculator <ArrowRight className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                  <StatTile label="Pays when it hits" value={signedPct(r.profitPct)} />
                  <StatTile
                    label="Hit rate"
                    value={`${((1 - r.exclProb) * 100).toFixed(1)}%`}
                    hint="venues' implied chance"
                  />
                  <StatTile
                    label="Uncovered"
                    value={r.excludeLabel ?? "none"}
                    tone={r.fullCover ? "text-success" : undefined}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ value */

function ValueTab({
  pool,
  hasGames,
  floor,
  minPct,
  setMinPct,
  legCount,
  setLegCount,
  exclFilter,
  setExclFilter,
  onSlip,
  onLoad,
}: {
  pool: Game[];
  hasGames: boolean;
  floor: number;
  minPct: string;
  setMinPct: (v: string) => void;
  legCount: number;
  setLegCount: (n: number) => void;
  exclFilter: string[];
  setExclFilter: (f: string[]) => void;
  onSlip: (r: ComboResult) => void;
  onLoad: (bet: ScannerBet) => void;
}) {
  // 1-game structures are separate contracts and may split across venues, so
  // they get the best price per outcome. Multi-game combos must live at one
  // venue to be a placeable RFQ parlay.
  const mode = legCount === 1 ? "cross" : "single";

  const rankedAll = useMemo(() => {
    if (pool.length < legCount) return [];
    return Array.from(scanCombos(pool, mode, floor, legCount), (result) => ({
      result,
      per100: expectedPer100(result.gamesOdds),
    })).sort((a, b) => b.per100 - a.per100 || a.result.exclProb - b.result.exclProb);
  }, [pool, mode, floor, legCount]);

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
        .filter(({ result }) =>
          matchesExclFilter(exclFilter, legCount, result.excludeLabel, result.fullCover),
        )
        .slice(0, MAX_ROWS),
    [rankedAll, exclFilter, legCount],
  );

  const togglePattern = (k: string) =>
    setExclFilter(exclFilter.includes(k) ? exclFilter.filter((x) => x !== k) : [...exclFilter, k]);

  const positive = ranked.filter((r) => r.per100 >= 100).length;
  const hiddenByFilter = rankedAll.length - ranked.length;

  return (
    <div className="space-y-4">
      <div className="card">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label className="label" htmlFor="poly-structure">
              Structure
            </label>
            <select
              id="poly-structure"
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
            <label className="label" htmlFor="poly-value-minpct">
              Min payout %
            </label>
            <input
              id="poly-value-minpct"
              value={minPct}
              onChange={(e) => setMinPct(e.target.value)}
              inputMode="decimal"
              className="input"
            />
          </div>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          The 1-game structure is the exchange-native one: two or three standing contracts, no RFQ,
          placeable exactly as priced — and it usually ranks best, because every extra leg
          multiplies in another venue spread.
        </p>

        <div className="mt-4 border-t border-border pt-3">
          <span className="label">Uncovered scenario</span>
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              onClick={() => setExclFilter([])}
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
        </div>
      </div>

      {!hasGames ? (
        <div className="card text-sm text-muted-foreground">
          Scan a league or load demo odds to rank the board.
        </div>
      ) : ranked.length === 0 ? (
        <div className="card text-sm text-muted-foreground">
          {hiddenByFilter > 0
            ? `All ${hiddenByFilter} qualifying results are hidden by the uncovered-scenario filter. Select more patterns, or set it back to Any.`
            : `Nothing qualifies at this payout floor across the ${pool.length} tightest exchange markets. Lower it, or pick a different structure.`}
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-baseline gap-x-2 rounded-lg border border-border bg-card px-4 py-2">
            <span className="text-lg font-extrabold leading-none text-primary">
              {ranked.length}
            </span>
            <span className="text-sm font-semibold">ranked by expected value</span>
            <span className="text-xs text-muted-foreground">
              · {positive} above break-even
              {positive === 0 ? " — every option below loses money on average" : ""}
            </span>
          </div>

          {ranked.map(({ result, per100 }, i) => {
            const corr = correlationNote(result.games);
            return (
              <div key={`${result.games.map((g) => g.id).join("-")}-${i}`} className="card">
                <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="mb-1 flex flex-wrap items-center gap-2">
                      <span className="rounded bg-secondary px-2 py-0.5 text-xs font-bold text-secondary-foreground">
                        {legCount === 1 ? "standing contracts" : `via ${result.bookLabel}`}
                      </span>
                      {legCount > 1 && (
                        <span className="rounded bg-warning/15 px-2 py-0.5 text-xs font-semibold text-warning">
                          RFQ estimate
                        </span>
                      )}
                      {corr && (
                        <span className="flex items-center gap-1 rounded bg-warning/15 px-2 py-0.5 text-xs font-semibold text-warning">
                          <AlertTriangle className="h-3 w-3" />
                          {corr}
                        </span>
                      )}
                    </div>
                    {result.games.map((g) => (
                      <div key={g.id} className="truncate text-sm font-semibold">
                        {g.home} v {g.away}
                        <span className="ml-2 text-xs font-normal text-muted-foreground">
                          {formatDateTime(g.commence)}
                          {g.league ? ` · ${g.league}` : ""}
                        </span>
                      </div>
                    ))}
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <button onClick={() => onSlip(result)} className="btn-secondary py-1.5 text-xs">
                      <ReceiptText className="h-3.5 w-3.5" /> Slip
                    </button>
                    <button
                      onClick={() => onLoad(buildComboBet(result))}
                      className="btn-primary py-1.5 text-xs"
                    >
                      Load into Calculator <ArrowRight className="h-3.5 w-3.5" />
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
                    value={`${((1 - result.exclProb) * 100).toFixed(1)}%`}
                    hint={result.fullCover ? "cannot lose" : "venues' implied chance"}
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
    </div>
  );
}
