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
  Eye,
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { ProtectedRoute } from "@/components/protected-route";
import { Alert } from "@/components/auth-shell";
import { cn } from "@/lib/utils";
import {
  fetchOddsConfigured,
  fetchSoccerLeagues,
  fetchLeagueOdds,
  type Game,
  type League,
} from "@/lib/odds-api";
import { useAuth } from "@/lib/auth";
import {
  scanCombos,
  evalSingleGameArb,
  buildComboBet,
  buildArbBet,
  excludePatternKey,
  exclPatternOptions,
  OUTCOMES,
  type ComboResult,
  type ScanMode,
} from "@/lib/scanner";
import { getDemoGames } from "@/lib/demo-odds";
import { SCAN_CACHE_KEY } from "@/lib/scan-cache";
import { fmt } from "@/lib/calculator";
import { ComboPreviewModal } from "@/components/combo-preview";

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
const MAX_DATE_GAMES = 30;
// ...but it keeps a bigger pool than it scans, so the kickoff-time window can
// pick from everything the scan paid for rather than from the capped slice.
// Only this many are retained, to keep the localStorage cache sane.
const MAX_DATE_POOL = 150;
// Regions carry 20+ bookmakers, so single-book mode can qualify thousands of
// rows; only the top N are rendered.
const MAX_RESULTS = 50;

/**
 * Take up to `limit` games spread evenly over the leagues that returned any,
 * one per league per pass, each league in kickoff order.
 *
 * Capping the globally-earliest kickoffs instead lets one early league evict
 * every later one, so adding leagues to a scan could _shrink_ the results:
 * the extra league pushed the previous leagues' games out of the cap rather
 * than adding to them. Round-robin keeps every selected league represented.
 */
const allocateAcrossLeagues = (byLeague: Game[][], limit: number): Game[] => {
  const queues = byLeague.map((gs) => [...gs]).filter((q) => q.length > 0);
  const out: Game[] = [];
  while (out.length < limit && queues.some((q) => q.length > 0)) {
    for (const q of queues) {
      if (out.length >= limit) break;
      const g = q.shift();
      if (g) out.push(g);
    }
  }
  return out.sort((a, b) => +new Date(a.commence) - +new Date(b.commence));
};

const OUTCOME_WORDS: Record<string, string> = { W: "wins", D: "draws", L: "loses" };

// For the excluded-scenario filter chips: "WL" -> "W+L", "a win + a loss".
const PATTERN_NOUNS: Record<string, string> = { W: "a win", D: "a draw", L: "a loss" };
const patternLabel = (key: string) => key.split("").join("+");
const patternWords = (key: string) =>
  key
    .split("")
    .map((o) => PATTERN_NOUNS[o])
    .join(" + ");

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

/** Kickoff as a local 'HH:MM', comparable to an <input type="time">. */
const localTime = (iso: string | Date): string => {
  const d = iso instanceof Date ? iso : new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
};

/**
 * True when a kickoff falls inside an optional local time-of-day window.
 * Either end may be blank, so "from 18:00" and "up to 20:00" both work, and
 * clearing both covers the whole day again.
 */
const inTimeWindow = (iso: string, from: string, to: string): boolean => {
  if (!from && !to) return true;
  const t = localTime(iso);
  return (!from || t >= from) && (!to || t <= to);
};

/** The Odds API wants commence-time bounds as ISO without milliseconds. */
const apiIso = (d: Date) => d.toISOString().replace(/\.\d+Z$/, "Z");

// Scan results are cached in localStorage so navigating away (or reloading)
// doesn't throw away a scan that cost API credits — rescanning is always an
// explicit button click. The Test workbench reads this same cache, so the key
// lives in lib/scan-cache.ts.
const CACHE_KEY = SCAN_CACHE_KEY;

interface ScanCache {
  league?: string;
  regions?: string;
  books?: string;
  minPct?: string;
  mode?: ScanMode;
  sortBy?: SortKey;
  teamCount?: number;
  exclFilter?: string[];
  dateFrom?: string;
  dateTo?: string;
  timeFrom?: string;
  timeTo?: string;
  scanTab?: ScanTab;
  scanDate?: string;
  selLeagues?: string[];
  dateGames?: Game[] | null;
  dateFetched?: number;
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
  const { session } = useAuth();
  // The key now lives on the server, so its presence is something we ask for
  // rather than read. Assume absent until the server answers, so the controls
  // never flash enabled.
  const [hasKey, setHasKey] = useState(false);
  // Server functions spend from a shared paid quota, so every call carries the
  // caller's session for the proxy to authorize.
  const token = session?.access_token ?? "";

  const [leagues, setLeagues] = useState<League[]>([]);
  const [league, setLeague] = useState("soccer_epl");
  const [regions, setRegions] = useState("eu,uk");
  const [books, setBooks] = useState("region");
  const [minPct, setMinPct] = useState("1");
  const [mode, setMode] = useState<ScanMode>("single");
  const [sortBy, setSortBy] = useState<SortKey>("profit");
  const [teamCount, setTeamCount] = useState(2);
  // Excluded-scenario patterns to keep, e.g. ["WL", "DL"]. Empty = no filter.
  // Keys for both combo sizes live together; only same-length keys apply.
  const [exclFilter, setExclFilter] = useState<string[]>([]);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  // Kickoff time-of-day window, both ends optional. Blank = the whole day.
  const [timeFrom, setTimeFrom] = useState("");
  const [timeTo, setTimeTo] = useState("");

  const [scanTab, setScanTab] = useState<ScanTab>("league");
  // Left empty for the server render: "today" depends on the viewer's timezone,
  // so seeding it here would disagree with the client and break hydration.
  // The mount effect below fills it in.
  const [scanDate, setScanDate] = useState("");
  const [selLeagues, setSelLeagues] = useState<string[]>(["soccer_epl"]);
  const [dateGames, setDateGames] = useState<Game[] | null>(null);
  // How many games the last date scan actually fetched, before the cap — so
  // the summary can admit when it is scanning a subset.
  const [dateFetched, setDateFetched] = useState(0);
  const [dateScannedAt, setDateScannedAt] = useState<number | null>(null);

  const [games, setGames] = useState<Game[] | null>(null); // null = not scanned yet
  const [source, setSource] = useState(""); // 'live' | 'demo'
  const [credits, setCredits] = useState<number | string | null>(null);
  // True when the last scan was answered entirely from the server's shared
  // cache, so it cost no credits — worth saying out loud.
  const [servedFromCache, setServedFromCache] = useState(false);
  const [scannedAt, setScannedAt] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // The combo currently open in the preview modal (null = closed).
  const [preview, setPreview] = useState<ComboResult | null>(null);
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
    if (c.exclFilter) setExclFilter(c.exclFilter);
    if (c.dateFrom) setDateFrom(c.dateFrom);
    if (c.dateTo) setDateTo(c.dateTo);
    if (c.timeFrom) setTimeFrom(c.timeFrom);
    if (c.timeTo) setTimeTo(c.timeTo);
    if (c.scanTab) setScanTab(c.scanTab);
    // Cached choice wins; otherwise default to the viewer's local today.
    setScanDate(c.scanDate || localDay(new Date()));
    if (c.selLeagues) setSelLeagues(c.selLeagues);
    if (c.dateGames) setDateGames(c.dateGames);
    if (c.dateFetched) setDateFetched(c.dateFetched);
    if (c.dateScannedAt) setDateScannedAt(c.dateScannedAt);
    if (c.games) setGames(c.games);
    if (c.source) setSource(c.source);
    if (c.credits != null) setCredits(c.credits);
    if (c.scannedAt) setScannedAt(c.scannedAt);
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
        // Keep the (possibly cache-restored) selection if it's still valid.
        setLeague((cur) => (ls.length && !ls.some((l) => l.key === cur) ? ls[0].key : cur));
      })
      .catch((e: Error) => setError(`Could not load leagues: ${e.message}`));
  }, [hasKey, token]);

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
          exclFilter,
          dateFrom,
          dateTo,
          timeFrom,
          timeTo,
          scanTab,
          scanDate,
          selLeagues,
          dateGames,
          dateFetched,
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
    exclFilter,
    dateFrom,
    dateTo,
    timeFrom,
    timeTo,
    scanTab,
    scanDate,
    selLeagues,
    dateGames,
    dateFetched,
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
      const {
        games: fetched,
        remaining,
        cached: fromCache,
      } = await fetchLeagueOdds(token, league, regions, books === "region" ? "" : books);
      const title = leagueTitle(league);
      const upcoming = fetched
        .sort((a, b) => +new Date(a.commence) - +new Date(b.commence))
        .slice(0, MAX_GAMES)
        .map((g) => ({ ...g, league: title }));
      setGames(upcoming);
      setSource("live");
      setCredits(remaining);
      setServedFromCache(fromCache);
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
          fetchLeagueOdds(
            token,
            k,
            regions,
            books === "region" ? "" : books,
            apiIso(start),
            apiIso(end),
          ),
        ),
      );
      const byLeague: Game[][] = [];
      const failed: string[] = [];
      let remaining: number | null = null;
      let fetched = 0;
      let allCached = true;
      settled.forEach((r, i) => {
        if (r.status === "fulfilled") {
          if (!r.value.cached) allCached = false;
          const title = leagueTitle(selLeagues[i]);
          const gs = r.value.games
            .map((g) => ({ ...g, league: title }))
            .sort((a, b) => +new Date(a.commence) - +new Date(b.commence));
          fetched += gs.length;
          if (gs.length > 0) byLeague.push(gs);
          const rem = parseFloat(String(r.value.remaining));
          // Requests run in parallel; the smallest counter is the freshest.
          if (!Number.isNaN(rem)) remaining = remaining == null ? rem : Math.min(remaining, rem);
        } else {
          failed.push(leagueTitle(selLeagues[i]));
        }
      });
      setDateGames(allocateAcrossLeagues(byLeague, MAX_DATE_POOL));
      setDateFetched(fetched);
      setDateScannedAt(Date.now());
      setServedFromCache(allCached && settled.some((r) => r.status === "fulfilled"));
      if (remaining != null) setCredits(remaining);
      if (failed.length > 0) {
        setError(
          `Could not fetch: ${failed.join(", ")}. Results below cover the leagues that worked.`,
        );
      } else if (fetched === 0) {
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
    if (!games || (!dateFrom && !dateTo && !timeFrom && !timeTo)) return games;
    return games.filter((g) => {
      const day = localDay(g.commence);
      return (
        (!dateFrom || day >= dateFrom) &&
        (!dateTo || day <= dateTo) &&
        inTimeWindow(g.commence, timeFrom, timeTo)
      );
    });
  }, [games, dateFrom, dateTo, timeFrom, timeTo]);

  /**
   * The date scan holds a pool of up to MAX_DATE_POOL games, so the kickoff
   * window narrows the pool first and only then is the scan cap shared out —
   * picking an evening window gives a full 30 evening games rather than
   * whatever survived a cap applied at fetch time.
   */
  const dateWindow = useMemo(() => {
    if (!dateGames) return null;
    const kept = dateGames.filter((g) => inTimeWindow(g.commence, timeFrom, timeTo));
    const byLeague = new Map<string, Game[]>();
    for (const g of kept) {
      const q = byLeague.get(g.league ?? "");
      if (q) q.push(g);
      else byLeague.set(g.league ?? "", [g]);
    }
    return allocateAcrossLeagues([...byLeague.values()], MAX_DATE_GAMES);
  }, [dateGames, timeFrom, timeTo]);

  // Whichever game list the active tab scans; results below render from this.
  const activeGames = scanTab === "league" ? filteredGames : dateWindow;

  // Filter keys that apply to the current combo size (2-char keys for pairs,
  // 3-char for triples) — the rest are kept in state but ignored.
  const activePatterns = useMemo(
    () => exclFilter.filter((k) => k.length === teamCount),
    [exclFilter, teamCount],
  );

  const { pairs, arbs, patternCounts, prefilterCount } = useMemo(() => {
    if (!activeGames)
      return {
        pairs: [] as ComboResult[],
        arbs: [],
        patternCounts: {} as Record<string, number>,
        prefilterCount: 0,
      };
    const scanned = scanCombos(activeGames, mode, minProfit, teamCount);
    // Per-pattern totals from the unfiltered scan, so each chip can say how
    // many results it represents even while others are filtered away.
    const patternCounts: Record<string, number> = {};
    for (const r of scanned) {
      if (r.excludeLabel) {
        const k = excludePatternKey(r.excludeLabel);
        patternCounts[k] = (patternCounts[k] ?? 0) + 1;
      }
    }
    // Keep only combos whose uncovered scenario matches a selected pattern.
    // Full covers have no uncovered scenario and always stay — guaranteed
    // profit should never be hidden by a risk filter.
    const filtered = activePatterns.length
      ? scanned.filter(
          (r) =>
            r.fullCover ||
            (r.excludeLabel != null && activePatterns.includes(excludePatternKey(r.excludeLabel))),
        )
      : scanned;
    // scanCombos returns safest-first; re-sort by profit when asked. Full
    // covers stay pinned on top either way — guaranteed beats risky.
    if (sortBy === "profit") {
      filtered.sort((a, b) => {
        if (a.fullCover !== b.fullCover) return a.fullCover ? -1 : 1;
        return b.profitPct - a.profitPct;
      });
    }
    return {
      pairs: filtered,
      arbs:
        mode === "cross"
          ? activeGames.map((g) => evalSingleGameArb(g, minProfit)).filter((a) => a !== null)
          : [],
      patternCounts,
      prefilterCount: scanned.length,
    };
  }, [activeGames, mode, minProfit, sortBy, teamCount, activePatterns]);

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
        {servedFromCache && (
          <span
            className="rounded-md bg-success/15 px-3 py-1.5 text-xs font-semibold text-success"
            title="Answered from the server's shared cache — the upstream API was not called"
          >
            Served from cache · no credits spent
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
          and add <code className="rounded bg-background px-1">ODDS_API_KEY=your-key</code> to{" "}
          <code className="rounded bg-background px-1">.env</code>, then restart the dev server. The
          name is deliberately not <code className="rounded bg-background px-1">VITE_</code>
          -prefixed so the key stays on the server. Until then, use demo data to try the workflow.
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

      {/*
        Two columns on desktop: scan controls on the left, results on the
        right. Below `lg` it collapses to one column and DOM order puts the
        controls on top with the results beneath.
      */}
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(300px,360px)_minmax(0,1fr)]">
        {/* ------------------------------------------------ controls column */}
        <aside className="space-y-4 lg:sticky lg:top-4">
          <div className="card grid gap-3">
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
              title={
                books !== "region" ? "Ignored while specific bookmakers are selected" : undefined
              }
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
              <div>
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

            <div className="flex flex-wrap items-end gap-2">
              <button
                onClick={() => void (scanTab === "league" ? scanLive() : scanByDate())}
                disabled={!hasKey || busy || (scanTab === "date" && !scanDate)}
                className="btn-primary flex-1 justify-center disabled:opacity-60"
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
                  <FlaskConical className="h-4 w-4" /> Demo
                </button>
              )}
            </div>
          </div>

          {/* Result shaping — only useful once there is something to shape. */}
          {activeGames && (
            <>
              {scanTab === "league" && (
                <div
                  className="card space-y-2"
                  title="Only pair games kicking off within this date range"
                >
                  <span className="label mb-0">Kickoff range</span>
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <input
                      type="date"
                      value={dateFrom}
                      max={dateTo || undefined}
                      onChange={(e) => setDateFrom(e.target.value)}
                      aria-label="Kickoff from date"
                      className="input w-auto flex-1"
                    />
                    <span className="text-muted-foreground">to</span>
                    <input
                      type="date"
                      value={dateTo}
                      min={dateFrom || undefined}
                      onChange={(e) => setDateTo(e.target.value)}
                      aria-label="Kickoff to date"
                      className="input w-auto flex-1"
                    />
                  </div>
                  {(dateFrom || dateTo) && (
                    <button
                      onClick={() => {
                        setDateFrom("");
                        setDateTo("");
                      }}
                      className="btn-secondary w-full justify-center py-1 text-xs"
                    >
                      Clear range
                    </button>
                  )}
                </div>
              )}

              {/* Kickoff time-of-day window — narrows whichever games the tab
                  already has, so it never costs credits and both ends are
                  optional (leave blank for the whole day). */}
              <div
                className="card space-y-2"
                title="Only combine games kicking off inside this time window"
              >
                <span className="label mb-0">
                  Kickoff time
                  <span className="ml-1 font-normal normal-case text-muted-foreground">
                    (optional — blank scans the whole day)
                  </span>
                </span>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <input
                    type="time"
                    value={timeFrom}
                    onChange={(e) => setTimeFrom(e.target.value)}
                    aria-label="Kickoff from time"
                    className="input w-auto flex-1"
                  />
                  <span className="text-muted-foreground">to</span>
                  <input
                    type="time"
                    value={timeTo}
                    onChange={(e) => setTimeTo(e.target.value)}
                    aria-label="Kickoff to time"
                    className="input w-auto flex-1"
                  />
                </div>
                {timeFrom && timeTo && timeFrom > timeTo && (
                  <p className="text-xs text-destructive">
                    The window ends before it starts, so nothing matches. Windows do not wrap past
                    midnight.
                  </p>
                )}
                {(timeFrom || timeTo) && (
                  <button
                    onClick={() => {
                      setTimeFrom("");
                      setTimeTo("");
                    }}
                    className="btn-secondary w-full justify-center py-1 text-xs"
                  >
                    Clear time
                  </button>
                )}
              </div>

              <div className="card space-y-3">
                <div>
                  <span className="label">Combine</span>
                  <div className="flex gap-2">
                    {[2, 3].map((n) => (
                      <Chip
                        key={n}
                        active={teamCount === n}
                        onClick={() => setTeamCount(n)}
                        title="How many games to combine per slip"
                      >
                        {n} teams ({Math.pow(3, n)})
                      </Chip>
                    ))}
                  </div>
                </div>
                <div>
                  <span className="label">Odds source</span>
                  <div className="flex flex-wrap gap-2">
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
                  </div>
                </div>
                <div>
                  <span className="label">Uncovered scenario</span>
                  <div className="flex flex-wrap gap-2">
                    <Chip
                      active={activePatterns.length === 0}
                      onClick={() =>
                        setExclFilter((cur) => cur.filter((k) => k.length !== teamCount))
                      }
                      title="No filter — show every qualifying combo, whatever scenario is left uncovered"
                    >
                      Any
                    </Chip>
                    {exclPatternOptions(teamCount).map((k) => (
                      <Chip
                        key={k}
                        active={activePatterns.includes(k)}
                        onClick={() =>
                          setExclFilter((cur) =>
                            cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k],
                          )
                        }
                        title={`Only combos whose uncovered scenario is ${patternWords(k)} — in either game order. Guaranteed full covers always stay.`}
                      >
                        {patternLabel(k)}
                        <span className="ml-1 opacity-60">{patternCounts[k] ?? 0}</span>
                      </Chip>
                    ))}
                  </div>
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    Which outcomes the one uncovered scenario may pair — e.g. W+L keeps only combos
                    that lose when one side wins and the other loses. Higher-odds patterns are less
                    likely to hit.
                  </p>
                </div>
                <div>
                  <span className="label">Sort</span>
                  <div className="flex flex-wrap gap-2">
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
                </div>
              </div>
            </>
          )}
        </aside>

        {/* -------------------------------------------------- results column */}
        <section className="min-w-0">
          {!activeGames ? (
            <div className="card text-center text-sm text-muted-foreground">
              No scan yet. Choose a league or a date on the left, then press{" "}
              <strong>Scan live odds</strong> — or try <strong>Demo</strong> to see the workflow
              without spending API credits.
            </div>
          ) : (
            <>
              {/* Scan meta */}
              <div className="mb-4 flex flex-wrap items-center gap-3">
                <span className="rounded-md bg-secondary px-3 py-1.5 text-xs text-secondary-foreground">
                  {scanTab === "date"
                    ? `Live odds · ${
                        gamesScanned < dateFetched
                          ? `${gamesScanned} of ${dateFetched} games`
                          : `${gamesScanned} games`
                      } on ${scanDate}`
                    : `${source === "demo" ? "Demo data" : "Live odds"} · ${
                        filteredGames?.length === games?.length
                          ? `${games?.length} games`
                          : `${filteredGames?.length} of ${games?.length} games in date range`
                      }`}{" "}
                  · {pairs.length}
                  {activePatterns.length > 0 && prefilterCount !== pairs.length
                    ? ` of ${prefilterCount}`
                    : ""}{" "}
                  qualifying {comboWord}
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
                                {fmt(a.odds[o])} @{" "}
                                <span className="font-semibold">{a.books[o]}</span>
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
                  {prefilterCount > 0
                    ? `All ${prefilterCount} qualifying ${comboWord} are hidden by the uncovered-scenario filter. Select more patterns or set it back to Any.`
                    : scanTab === "league" &&
                        filteredGames?.length === 0 &&
                        (games?.length ?? 0) > 0
                      ? "No scanned games kick off in the selected date range. Widen or clear the kickoff filter."
                      : (timeFrom || timeTo) &&
                          activeGames.length === 0 &&
                          (scanTab === "date" ? (dateGames?.length ?? 0) > 0 : true)
                        ? "No scanned games kick off inside the selected time window. Widen or clear it."
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
                              {r.fullCover ? scenarioCount : scenarioCount - 1}/{scenarioCount}{" "}
                              covered
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

                      <div className="mt-3 flex justify-end gap-2">
                        <button
                          onClick={() => setPreview(r)}
                          className="btn-secondary py-1.5 text-xs"
                        >
                          <Eye className="h-3.5 w-3.5" /> Preview
                        </button>
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
                risk-free: the excluded scenario is usually the bookmaker&apos;s favourite outcome,
                and its stake is lost if it happens. Stakes shown assume a 100 budget — adjust the
                Stake field after loading. Odds move; re-check them on the bookmaker before placing.
              </p>
            </>
          )}
        </section>
      </div>

      {preview && (
        <ComboPreviewModal
          result={preview}
          onClose={() => setPreview(null)}
          onLoad={() => {
            openInCalculator(buildComboBet(preview));
            setPreview(null);
          }}
        />
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
