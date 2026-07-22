import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  Radar,
  RefreshCw,
  ShieldCheck,
  AlertTriangle,
  ArrowRight,
  Clock,
  FlaskConical,
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { ProtectedRoute } from "@/components/protected-route";
import { Alert } from "@/components/auth-shell";
import { cn } from "@/lib/utils";
import {
  hasOddsApiKey,
  fetchSoccerLeagues,
  fetchLeagueOdds,
  type Game,
  type League,
} from "@/lib/odds-api";
import {
  scanCombos,
  evalSingleGameArb,
  buildComboBet,
  buildArbBet,
  OUTCOMES,
  type ComboResult,
  type ScanMode,
} from "@/lib/scanner";
import { getDemoGames } from "@/lib/demo-odds";
import { fmt } from "@/lib/calculator";

export const Route = createFileRoute("/scanner")({
  head: () => ({
    meta: [
      { title: "Scanner — BetMaster" },
      {
        name: "description",
        content: "Scan live bookmaker odds for profitable cover-betting combinations.",
      },
      { property: "og:title", content: "Scanner — BetMaster" },
      {
        property: "og:description",
        content: "Find combinations that clear your profit floor across leagues and bookmakers.",
      },
    ],
  }),
  component: ScannerRoute,
});

function ScannerRoute() {
  return (
    <ProtectedRoute>
      <ScannerPage />
    </ProtectedRoute>
  );
}

const REGION_OPTIONS = [
  { value: "eu", label: "Europe (incl. 1xBet)" },
  { value: "uk", label: "UK (incl. Betway)" },
  { value: "eu,uk", label: "Europe + UK" },
];

// Restrict a scan to bookmakers you actually hold accounts with — cross-book
// arbs are only placeable when you can bet every leg. 'region' keeps the
// default behaviour (every book in the selected region).
const BOOK_OPTIONS = [
  { value: "region", label: "All in selected region" },
  { value: "onexbet", label: "1xBet only" },
  { value: "betway", label: "Betway only" },
  { value: "onexbet,betway", label: "1xBet + Betway" },
  { value: "onexbet,bet365", label: "1xBet + Bet365" },
  { value: "betway,bet365", label: "Betway + Bet365" },
  { value: "onexbet,betway,bet365", label: "1xBet + Betway + Bet365" },
];

const SORTS = [
  { key: "profit", label: "Highest profit %" },
  { key: "safest", label: "Safest first" },
] as const;
type SortKey = (typeof SORTS)[number]["key"];

// Two ways to pick which games get paired: everything from one league, or
// everything (across the selected leagues) kicking off on one calendar day.
const TABS = [
  { key: "league", label: "By league" },
  { key: "date", label: "By date (cross-league)" },
] as const;
type ScanTab = (typeof TABS)[number]["key"];

// Cap how many upcoming games are paired so a big league stays readable.
const MAX_GAMES = 14;
// The date scan merges several leagues, so allow a few more before capping.
const MAX_DATE_GAMES = 24;
// Regions carry 20+ bookmakers, so single-book mode can qualify thousands of
// rows; only the top N are rendered.
const MAX_RESULTS = 50;

const OUTCOME_WORDS: Record<string, string> = { W: "wins", D: "draws", L: "loses" };

/** "AW + BD" -> "Arsenal wins + Inter draws" (one clause per game). */
const excludeText = (result: ComboResult): string | null => {
  if (!result.excludeLabel) return null;
  return result.excludeLabel
    .split(" + ")
    .map((tok, i) => `${result.games[i].home} ${OUTCOME_WORDS[tok[1]]}`)
    .join(" + ");
};

const kickoff = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    day: "numeric",
    month: "short",
  });

/** Kickoff as a local-time 'YYYY-MM-DD', comparable to an <input type="date">. */
const localDay = (iso: string | Date): string => {
  const d = iso instanceof Date ? iso : new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

/** The Odds API wants commence-time bounds as ISO without milliseconds. */
const apiIso = (d: Date) => d.toISOString().replace(/\.\d+Z$/, "Z");

// Scan results are cached in localStorage so navigating away (or reloading)
// doesn't throw away a scan that cost API credits — rescanning is always an
// explicit button click.
const CACHE_KEY = "scanner-cache";

interface ScanCache {
  league?: string;
  regions?: string;
  books?: string;
  minPct?: string;
  mode?: ScanMode;
  sortBy?: SortKey;
  teamCount?: number;
  dateFrom?: string;
  dateTo?: string;
  scanTab?: ScanTab;
  scanDate?: string;
  selLeagues?: string[];
  dateGames?: Game[] | null;
  dateScannedAt?: number | null;
  games?: Game[] | null;
  source?: string;
  credits?: number | string | null;
  scannedAt?: number | null;
}

const loadCache = (): ScanCache => {
  if (typeof window === "undefined") return {};
  try {
    return (JSON.parse(localStorage.getItem(CACHE_KEY) ?? "null") as ScanCache) || {};
  } catch {
    return {};
  }
};

const scanAge = (ts: number): string => {
  const mins = Math.round((Date.now() - ts) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const h = Math.floor(mins / 60);
  return `${h}h ${mins % 60}m ago`;
};

function ScannerPage() {
  const navigate = useNavigate();
  const hasKey = hasOddsApiKey();

  const [leagues, setLeagues] = useState<League[]>([]);
  const [league, setLeague] = useState("soccer_epl");
  const [regions, setRegions] = useState("eu,uk");
  const [books, setBooks] = useState("region");
  const [minPct, setMinPct] = useState("1");
  const [mode, setMode] = useState<ScanMode>("single");
  const [sortBy, setSortBy] = useState<SortKey>("profit");
  const [teamCount, setTeamCount] = useState(2);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const [scanTab, setScanTab] = useState<ScanTab>("league");
  // Left empty for the server render: "today" depends on the viewer's timezone,
  // so seeding it here would disagree with the client and break hydration.
  // The mount effect below fills it in.
  const [scanDate, setScanDate] = useState("");
  const [selLeagues, setSelLeagues] = useState<string[]>(["soccer_epl"]);
  const [dateGames, setDateGames] = useState<Game[] | null>(null);
  const [dateScannedAt, setDateScannedAt] = useState<number | null>(null);

  const [games, setGames] = useState<Game[] | null>(null); // null = not scanned yet
  const [source, setSource] = useState(""); // 'live' | 'demo'
  const [credits, setCredits] = useState<number | string | null>(null);
  const [scannedAt, setScannedAt] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Guards the cache write until the cache read has happened, so the first
  // render never overwrites a good cache with defaults.
  const [hydrated, setHydrated] = useState(false);

  // Restore the cache after mount, not during render — the server has no
  // localStorage, so reading it in a state initializer would desync hydration.
  useEffect(() => {
    const c = loadCache();
    if (c.league) setLeague(c.league);
    if (c.regions) setRegions(c.regions);
    if (c.books) setBooks(c.books);
    if (c.minPct) setMinPct(c.minPct);
    if (c.mode) setMode(c.mode);
    if (c.sortBy) setSortBy(c.sortBy);
    if (c.teamCount) setTeamCount(c.teamCount);
    if (c.dateFrom) setDateFrom(c.dateFrom);
    if (c.dateTo) setDateTo(c.dateTo);
    if (c.scanTab) setScanTab(c.scanTab);
    // Cached choice wins; otherwise default to the viewer's local today.
    setScanDate(c.scanDate || localDay(new Date()));
    if (c.selLeagues) setSelLeagues(c.selLeagues);
    if (c.dateGames) setDateGames(c.dateGames);
    if (c.dateScannedAt) setDateScannedAt(c.dateScannedAt);
    if (c.games) setGames(c.games);
    if (c.source) setSource(c.source);
    if (c.credits != null) setCredits(c.credits);
    if (c.scannedAt) setScannedAt(c.scannedAt);
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hasKey) return;
    fetchSoccerLeagues()
      .then((ls) => {
        setLeagues(ls);
        // Keep the (possibly cache-restored) selection if it's still valid.
        setLeague((cur) => (ls.length && !ls.some((l) => l.key === cur) ? ls[0].key : cur));
      })
      .catch((e: Error) => setError(`Could not load leagues: ${e.message}`));
  }, [hasKey]);

  // Persist everything needed to restore this page after navigating away.
  useEffect(() => {
    if (!hydrated) return;
    if (!games && !dateGames) return;
    try {
      localStorage.setItem(
        CACHE_KEY,
        JSON.stringify({
          league,
          regions,
          books,
          minPct,
          mode,
          sortBy,
          teamCount,
          dateFrom,
          dateTo,
          scanTab,
          scanDate,
          selLeagues,
          dateGames,
          dateScannedAt,
          games,
          source,
          credits,
          scannedAt,
        } satisfies ScanCache),
      );
    } catch {
      // Quota/serialization failures just mean no cache — never break the page.
    }
  }, [
    hydrated,
    league,
    regions,
    books,
    minPct,
    mode,
    sortBy,
    teamCount,
    dateFrom,
    dateTo,
    scanTab,
    scanDate,
    selLeagues,
    dateGames,
    dateScannedAt,
    games,
    source,
    credits,
    scannedAt,
  ]);

  const leagueTitle = (key: string) => leagues.find((l) => l.key === key)?.title || key;

  const scanLive = async () => {
    setBusy(true);
    setError("");
    try {
      const { games: fetched, remaining } = await fetchLeagueOdds(
        league,
        regions,
        books === "region" ? "" : books,
      );
      const title = leagueTitle(league);
      const upcoming = fetched
        .sort((a, b) => +new Date(a.commence) - +new Date(b.commence))
        .slice(0, MAX_GAMES)
        .map((g) => ({ ...g, league: title }));
      setGames(upcoming);
      setSource("live");
      setCredits(remaining);
      setScannedAt(Date.now());
      if (upcoming.length === 0)
        setError("No upcoming games with 3-way odds in this league right now.");
    } catch (e) {
      setError(`Scan failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const scanDemo = () => {
    setError("");
    setGames(getDemoGames());
    setSource("demo");
    setScannedAt(Date.now());
  };

  /**
   * Fetch every selected league restricted to the chosen local day, tag each
   * game with its league, and merge — pairing then works across leagues.
   */
  const scanByDate = async () => {
    if (!scanDate) return; // still hydrating; the date input has no value yet
    if (selLeagues.length === 0) {
      setError("Select at least one league to scan.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const start = new Date(`${scanDate}T00:00:00`);
      const end = new Date(start.getTime() + 24 * 3600 * 1000);
      const settled = await Promise.allSettled(
        selLeagues.map((k) =>
          fetchLeagueOdds(k, regions, books === "region" ? "" : books, apiIso(start), apiIso(end)),
        ),
      );
      const merged: Game[] = [];
      const failed: string[] = [];
      let remaining: number | null = null;
      settled.forEach((r, i) => {
        if (r.status === "fulfilled") {
          const title = leagueTitle(selLeagues[i]);
          r.value.games.forEach((g) => merged.push({ ...g, league: title }));
          const rem = parseFloat(String(r.value.remaining));
          // Requests run in parallel; the smallest counter is the freshest.
          if (!Number.isNaN(rem)) remaining = remaining == null ? rem : Math.min(remaining, rem);
        } else {
          failed.push(leagueTitle(selLeagues[i]));
        }
      });
      merged.sort((a, b) => +new Date(a.commence) - +new Date(b.commence));
      setDateGames(merged.slice(0, MAX_DATE_GAMES));
      setDateScannedAt(Date.now());
      if (remaining != null) setCredits(remaining);
      if (failed.length > 0) {
        setError(
          `Could not fetch: ${failed.join(", ")}. Results below cover the leagues that worked.`,
        );
      } else if (merged.length === 0) {
        setError("No games with 3-way odds on that date in the selected leagues.");
      }
    } catch (e) {
      setError(`Scan failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const toggleLeague = (key: string) =>
    setSelLeagues((cur) => (cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key]));

  // One odds call costs (regions) credits, or 1 per 10 named bookmakers.
  const creditsPerLeague =
    books === "region" ? regions.split(",").length : Math.ceil(books.split(",").length / 10);
  const scanCost = selLeagues.length * creditsPerLeague;

  const minProfit = Math.max(0, parseFloat(minPct) || 0);

  // Kickoff-date filter applied to the already-fetched games — pure client
  // side, so narrowing the range never costs API credits.
  const filteredGames = useMemo(() => {
    if (!games || (!dateFrom && !dateTo)) return games;
    return games.filter((g) => {
      const day = localDay(g.commence);
      return (!dateFrom || day >= dateFrom) && (!dateTo || day <= dateTo);
    });
  }, [games, dateFrom, dateTo]);

  // Whichever game list the active tab scans; results below render from this.
  const activeGames = scanTab === "league" ? filteredGames : dateGames;

  const { pairs, arbs } = useMemo(() => {
    if (!activeGames) return { pairs: [] as ComboResult[], arbs: [] };
    // scanCombos returns safest-first; re-sort by profit when asked. Full
    // covers stay pinned on top either way — guaranteed beats risky.
    const scanned = scanCombos(activeGames, mode, minProfit, teamCount);
    if (sortBy === "profit") {
      scanned.sort((a, b) => {
        if (a.fullCover !== b.fullCover) return a.fullCover ? -1 : 1;
        return b.profitPct - a.profitPct;
      });
    }
    return {
      pairs: scanned,
      arbs:
        mode === "cross"
          ? activeGames.map((g) => evalSingleGameArb(g, minProfit)).filter((a) => a !== null)
          : [],
    };
  }, [activeGames, mode, minProfit, sortBy, teamCount]);

  // Total scenarios for the current combo size (9 for pairs, 27 for triples).
  const scenarioCount = Math.pow(3, teamCount);
  const comboWord = teamCount === 3 ? "triples" : "pairs";

  // Headline counts for the summary beside the scan tabs. `pairs` is the full
  // qualifying set — the list further down renders only the top MAX_RESULTS —
  // so this is the only place the true total is visible.
  const fullCovers = pairs.filter((p) => p.fullCover).length;
  const gamesScanned = activeGames ? activeGames.length : 0;
  const totalResults = pairs.length + arbs.length;

  const openInCalculator = (bet: unknown) =>
    navigate({ to: "/calculator", state: { loadBet: bet } as never });

  const activeScannedAt = scanTab === "date" ? dateScannedAt : scannedAt;

  return (
    <AppShell>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold md:text-3xl">Scanner</h1>
          <p className="max-w-3xl text-sm text-muted-foreground">
            Combines upcoming games into pairs or triples and finds cover bets where all but one
            scenario clears your profit floor — plus true cross-book arbs. Bets are placed manually
            at the bookmaker; the scanner only reads odds.
          </p>
        </div>
        {credits != null && (
          <span
            className="rounded-md bg-secondary px-3 py-1.5 font-mono text-xs text-secondary-foreground"
            title="The Odds API credits left this month"
          >
            API credits left: {credits}
          </span>
        )}
      </div>

      {!hasKey && (
        <Alert tone="info">
          No odds API key configured. Get a free key at{" "}
          <a
            href="https://the-odds-api.com"
            target="_blank"
            rel="noreferrer"
            className="font-semibold text-primary hover:underline"
          >
            the-odds-api.com
          </a>{" "}
          and add <code className="rounded bg-background px-1">VITE_ODDS_API_KEY=your-key</code> to{" "}
          <code className="rounded bg-background px-1">.env</code>, then restart the dev server.
          Until then, use demo data to try the workflow.
        </Alert>
      )}
      {error && <Alert tone="error">{error}</Alert>}

      {/* Scan mode tabs + scan totals */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-lg border border-border bg-card p-1" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.key}
              role="tab"
              aria-selected={scanTab === t.key}
              onClick={() => {
                setScanTab(t.key);
                setError("");
              }}
              className={cn(
                "rounded-md px-4 py-2 text-sm font-medium transition",
                scanTab === t.key
                  ? "bg-primary text-primary-foreground"
                  : "text-foreground hover:bg-accent",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Only meaningful once a scan has run. */}
        {activeGames && (
          <div
            aria-live="polite"
            className="flex flex-wrap items-baseline gap-x-2 gap-y-1 rounded-lg border border-border bg-card px-4 py-2"
          >
            <span className="text-lg font-extrabold leading-none text-primary">{totalResults}</span>
            <span className="text-sm font-semibold text-foreground">
              {totalResults === 1 ? "result" : "results"}
            </span>
            <span className="text-xs text-muted-foreground">
              from {gamesScanned} game{gamesScanned === 1 ? "" : "s"} · {pairs.length} {comboWord}
              {mode === "cross" ? ` · ${arbs.length} arbs` : ""}
              {fullCovers > 0 ? ` · ${fullCovers} guaranteed` : ""}
              {pairs.length > MAX_RESULTS ? ` · top ${MAX_RESULTS} shown` : ""}
            </span>
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="card mb-4 grid gap-3 md:grid-cols-4">
        {scanTab === "league" ? (
          <div>
            <label className="label" htmlFor="league">
              League
            </label>
            <select
              id="league"
              value={league}
              onChange={(e) => setLeague(e.target.value)}
              disabled={!hasKey}
              className="input"
            >
              {leagues.length === 0 && <option value="soccer_epl">EPL</option>}
              {leagues.map((l) => (
                <option key={l.key} value={l.key}>
                  {l.title}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <div>
            <label className="label" htmlFor="scanDate">
              Match date
            </label>
            <input
              id="scanDate"
              type="date"
              value={scanDate}
              onChange={(e) => setScanDate(e.target.value)}
              disabled={!hasKey}
              className="input"
            />
          </div>
        )}

        <div>
          <label className="label" htmlFor="books">
            Bookmakers
          </label>
          <select
            id="books"
            value={books}
            onChange={(e) => setBooks(e.target.value)}
            disabled={!hasKey}
            className="input"
          >
            {BOOK_OPTIONS.map((b) => (
              <option key={b.value} value={b.value}>
                {b.label}
              </option>
            ))}
          </select>
        </div>

        <div
          title={books !== "region" ? "Ignored while specific bookmakers are selected" : undefined}
        >
          <label className="label" htmlFor="regions">
            Bookmaker region
          </label>
          <select
            id="regions"
            value={regions}
            onChange={(e) => setRegions(e.target.value)}
            disabled={!hasKey || books !== "region"}
            className="input disabled:opacity-50"
          >
            {REGION_OPTIONS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="label" htmlFor="minPct">
            Min profit %
          </label>
          <input
            id="minPct"
            type="number"
            min="0"
            step="0.5"
            value={minPct}
            onChange={(e) => setMinPct(e.target.value)}
            className="input"
          />
        </div>

        {scanTab === "date" && (
          <div className="md:col-span-4">
            <label className="label">
              Leagues to scan — {selLeagues.length} selected, ~{scanCost} credit
              {scanCost === 1 ? "" : "s"} per scan
            </label>
            {leagues.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {hasKey ? "Loading in-season leagues…" : "League list needs an API key."}
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
        )}

        <div className="flex items-end gap-2 md:col-span-4">
          <button
            onClick={() => void (scanTab === "league" ? scanLive() : scanByDate())}
            disabled={!hasKey || busy || (scanTab === "date" && !scanDate)}
            className="btn-primary disabled:opacity-60"
          >
            <RefreshCw className={cn("h-4 w-4", busy && "animate-spin")} />
            {busy
              ? "Scanning…"
              : scanTab === "date"
                ? dateGames
                  ? "Rescan this date"
                  : "Scan this date"
                : source === "live"
                  ? "Rescan live odds"
                  : "Scan live odds"}
          </button>
          {scanTab === "league" && (
            <button
              onClick={scanDemo}
              disabled={busy}
              className="btn-secondary disabled:opacity-60"
            >
              <FlaskConical className="h-4 w-4" /> Demo data
            </button>
          )}
        </div>
      </div>

      {activeGames && (
        <>
          {/* Scan meta */}
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <span className="rounded-md bg-secondary px-3 py-1.5 text-xs text-secondary-foreground">
              {scanTab === "date"
                ? `Live odds · ${dateGames?.length ?? 0} games on ${scanDate}`
                : `${source === "demo" ? "Demo data" : "Live odds"} · ${
                    filteredGames?.length === games?.length
                      ? `${games?.length} games`
                      : `${filteredGames?.length} of ${games?.length} games in date range`
                  }`}{" "}
              · {pairs.length} qualifying {comboWord}
              {books !== "region" && (scanTab === "date" || source === "live")
                ? ` · ${BOOK_OPTIONS.find((b) => b.value === books)?.label ?? books}`
                : ""}
            </span>
            {activeScannedAt && (
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Clock className="h-3.5 w-3.5" /> scanned {scanAge(activeScannedAt)}
              </span>
            )}
          </div>

          {scanTab === "league" && (
            <div
              className="mb-4 flex flex-wrap items-center gap-2 text-xs"
              title="Only pair games kicking off within this date range"
            >
              <span className="font-semibold uppercase tracking-wide text-muted-foreground">
                Kickoff
              </span>
              <input
                type="date"
                value={dateFrom}
                max={dateTo || undefined}
                onChange={(e) => setDateFrom(e.target.value)}
                aria-label="Kickoff from date"
                className="input w-auto"
              />
              <span className="text-muted-foreground">to</span>
              <input
                type="date"
                value={dateTo}
                min={dateFrom || undefined}
                onChange={(e) => setDateTo(e.target.value)}
                aria-label="Kickoff to date"
                className="input w-auto"
              />
              {(dateFrom || dateTo) && (
                <button
                  onClick={() => {
                    setDateFrom("");
                    setDateTo("");
                  }}
                  className="btn-secondary py-1 text-xs"
                >
                  Clear
                </button>
              )}
            </div>
          )}

          {/* Result options */}
          <div className="mb-4 flex flex-wrap gap-2">
            {[2, 3].map((n) => (
              <Chip
                key={n}
                active={teamCount === n}
                onClick={() => setTeamCount(n)}
                title="How many games to combine per slip"
              >
                {n} teams ({Math.pow(3, n)} scenarios)
              </Chip>
            ))}
            <Chip
              active={mode === "single"}
              onClick={() => setMode("single")}
              title="All legs at one bookmaker — a slip you can actually place"
            >
              Same bookmaker ({scenarioCount - 1}/{scenarioCount})
            </Chip>
            <Chip
              active={mode === "cross"}
              onClick={() => setMode("cross")}
              title="Best price per outcome across books — legs placed at different bookmakers"
            >
              Best odds across books
            </Chip>
            {SORTS.map((s) => (
              <Chip
                key={s.key}
                active={sortBy === s.key}
                onClick={() => setSortBy(s.key)}
                title={
                  s.key === "profit"
                    ? "Order by profit on covered scenarios, highest first"
                    : "Order by lowest chance of the excluded scenario hitting"
                }
              >
                {s.label}
              </Chip>
            ))}
          </div>

          {/* Single-game arbs */}
          {mode === "cross" && arbs.length > 0 && (
            <div className="mb-6">
              <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-primary">
                <ShieldCheck className="h-4 w-4" /> Single-game arbs (risk-free across books)
              </h2>
              <div className="grid gap-3 md:grid-cols-2">
                {arbs.map((a) => (
                  <div key={a.game.id} className="card border-success/40 bg-success/5">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <div className="font-semibold">
                        {a.game.home} v {a.game.away}
                      </div>
                      <span className="shrink-0 rounded-full bg-success px-2 py-0.5 text-xs font-bold text-success-foreground">
                        +{a.profitPct.toFixed(2)}% guaranteed
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {kickoff(a.game.commence)}
                      {a.game.league ? ` · ${a.game.league}` : ""}
                    </div>
                    <div className="mt-3 space-y-1 text-sm">
                      {OUTCOMES.map((o) => (
                        <div key={o} className="flex justify-between">
                          <span className="font-mono">{o}</span>
                          <span>
                            {fmt(a.odds[o])} @ <span className="font-semibold">{a.books[o]}</span>
                          </span>
                        </div>
                      ))}
                    </div>
                    <div className="mt-3 flex justify-end">
                      <button
                        onClick={() => openInCalculator(buildArbBet(a))}
                        className="btn-primary py-1.5 text-xs"
                      >
                        Load into Calculator <ArrowRight className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Combination results */}
          <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-primary">
            <Radar className="h-4 w-4" />
            {teamCount === 3 ? "Game triples" : "Game pairs"}
            {mode === "single"
              ? " — one bookmaker, best single exclusion"
              : " — best odds per leg across books"}
          </h2>

          {pairs.length === 0 ? (
            <div className="card text-sm text-muted-foreground">
              {scanTab === "league" && filteredGames?.length === 0 && (games?.length ?? 0) > 0
                ? "No scanned games kick off in the selected date range. Widen or clear the kickoff filter."
                : activeGames.length === 0
                  ? "No games with 3-way odds found. Scan another date or add leagues."
                  : activeGames.length < teamCount
                    ? `Only ${activeGames.length} game${activeGames.length === 1 ? "" : "s"} available — ${teamCount}-team combos need at least ${teamCount}. ` +
                      (scanTab === "date"
                        ? "Add more leagues or try another date."
                        : "Widen the kickoff filter.")
                    : `No ${comboWord} clear ${minProfit}% profit with these odds. Try a lower floor${
                        teamCount === 3 ? ", switch to 2 teams," : ""
                      } or ${scanTab === "date" ? "more leagues" : "another league"}.`}
            </div>
          ) : (
            <div className="space-y-3">
              {pairs.length > MAX_RESULTS && (
                <p className="text-xs text-muted-foreground">
                  Showing the top {MAX_RESULTS} of {pairs.length} qualifying results (
                  {sortBy === "profit" ? "highest profit" : "safest"} first).
                </p>
              )}
              {pairs.slice(0, MAX_RESULTS).map((r, idx) => (
                <div
                  key={`${r.games.map((g) => g.id).join("-")}-${r.bookLabel}-${idx}`}
                  className={cn("card", r.fullCover && "border-success/40 bg-success/5")}
                >
                  <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="mb-1 flex flex-wrap items-center gap-2">
                        <span
                          className={cn(
                            "rounded-full px-2 py-0.5 text-xs font-bold",
                            r.fullCover
                              ? "bg-success text-success-foreground"
                              : "bg-primary text-primary-foreground",
                          )}
                        >
                          {r.fullCover ? scenarioCount : scenarioCount - 1}/{scenarioCount} covered
                        </span>
                        <span className="text-xs text-muted-foreground">via {r.bookLabel}</span>
                      </div>
                      <div className="space-y-0.5">
                        {r.games.map((g) => (
                          <div key={g.id} className="text-sm font-medium">
                            {g.home} <span className="text-muted-foreground">v</span> {g.away}
                            <span className="ml-2 text-xs text-muted-foreground">
                              {kickoff(g.commence)}
                              {g.league ? ` · ${g.league}` : ""}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-2xl font-bold text-success">
                        +{r.profitPct.toFixed(2)}%
                      </div>
                      <div className="text-xs text-muted-foreground">on covered scenarios</div>
                    </div>
                  </div>

                  <div
                    className={cn(
                      "flex items-start gap-2 rounded-md p-3 text-xs",
                      r.fullCover
                        ? "bg-success/10 text-success"
                        : "bg-warning/10 text-warning-foreground",
                    )}
                  >
                    {r.fullCover ? (
                      <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
                    ) : (
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    )}
                    <span>
                      {r.fullCover
                        ? `All ${scenarioCount} scenarios covered — no losing outcome.`
                        : `${scenarioCount - 1} of ${scenarioCount} covered — loses only if ${excludeText(r)} (~${(r.exclProb * 100).toFixed(0)}% implied chance).`}
                    </span>
                  </div>

                  <div className="mt-3 flex justify-end">
                    <button
                      onClick={() => openInCalculator(buildComboBet(r))}
                      className="btn-primary py-1.5 text-xs"
                    >
                      Load into Calculator <ArrowRight className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <p className="mt-6 text-xs text-muted-foreground">
            <strong>Note:</strong> “{scenarioCount - 1} of {scenarioCount} covered” is not
            risk-free: the excluded scenario is usually the bookmaker&apos;s favourite outcome, and
            its stake is lost if it happens. Stakes shown assume a 100 budget — adjust the Stake
            field after loading. Odds move; re-check them on the bookmaker before placing.
          </p>
        </>
      )}
    </AppShell>
  );
}

function Chip({
  active,
  children,
  onClick,
  title,
}: {
  active?: boolean;
  children: React.ReactNode;
  onClick?: () => void;
  title?: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={cn(
        "rounded-full border px-3 py-1.5 text-xs font-medium transition",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-card text-foreground hover:bg-accent",
      )}
    >
      {children}
    </button>
  );
}
