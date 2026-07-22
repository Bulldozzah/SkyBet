// Thin client for The Odds API (https://the-odds-api.com) — free tier is
// 500 credits/month; one odds call costs (number of regions) credits, or
// 1 credit per 10 named bookmakers. The key lives in .env as
// VITE_ODDS_API_KEY.

const BASE = "https://api.the-odds-api.com/v4";
const apiKey = import.meta.env.VITE_ODDS_API_KEY as string | undefined;

export const hasOddsApiKey = (): boolean => !!apiKey;

/** One bookmaker's three-way prices for a fixture. */
export interface BookOdds {
  key: string;
  title: string;
  W: number;
  D: number;
  L: number;
}

/** A fixture normalized from the API, with every usable bookmaker. */
export interface Game {
  id: string;
  home: string;
  away: string;
  commence: string;
  /** Attached by the Scanner after fetching, for display. */
  league?: string;
  books: BookOdds[];
}

export interface League {
  key: string;
  title: string;
}

export interface OddsResponse {
  games: Game[];
  /** Credits left this month, straight from the response headers. */
  remaining: string | null;
  used: string | null;
}

const apiError = async (res: Response): Promise<string> => {
  try {
    const body = await res.json();
    return body.message || `${res.status} ${res.statusText}`;
  } catch {
    return `${res.status} ${res.statusText}`;
  }
};

/**
 * Soccer leagues currently in season. The /sports endpoint is free (costs no
 * credits), so it is always fetched live for the league pickers.
 */
export async function fetchSoccerLeagues(): Promise<League[]> {
  const res = await fetch(`${BASE}/sports/?apiKey=${apiKey}`);
  if (!res.ok) throw new Error(await apiError(res));
  const all = await res.json();
  return (all as { key: string; title: string; group: string; active: boolean }[])
    .filter((s) => s.group === "Soccer" && s.active)
    .map((s) => ({ key: s.key, title: s.title }));
}

/**
 * Head-to-head (1X2) odds for a league. Passing `bookmakers` (comma-separated
 * keys, e.g. "onexbet,betway") overrides the region and fetches exactly those
 * books — cheaper too. Optional `from`/`to` (ISO, no milliseconds) restrict
 * results to fixtures commencing in that window; same credit cost, smaller
 * payload.
 */
export async function fetchLeagueOdds(
  sportKey: string,
  regions: string,
  bookmakers = "",
  from = "",
  to = "",
): Promise<OddsResponse> {
  const selector = bookmakers ? `bookmakers=${bookmakers}` : `regions=${regions}`;
  const window =
    (from ? `&commenceTimeFrom=${encodeURIComponent(from)}` : "") +
    (to ? `&commenceTimeTo=${encodeURIComponent(to)}` : "");
  const url =
    `${BASE}/sports/${sportKey}/odds/?apiKey=${apiKey}` +
    `&${selector}&markets=h2h&oddsFormat=decimal${window}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(await apiError(res));
  const events = await res.json();
  return {
    games: normalizeEvents(events),
    remaining: res.headers.get("x-requests-remaining"),
    used: res.headers.get("x-requests-used"),
  };
}

interface ApiOutcome {
  name: string;
  price: number;
}
interface ApiMarket {
  key: string;
  outcomes?: ApiOutcome[];
}
interface ApiBookmaker {
  key: string;
  title: string;
  markets?: ApiMarket[];
}
interface ApiEvent {
  id: string;
  home_team: string;
  away_team: string;
  commence_time: string;
  bookmakers?: ApiBookmaker[];
}

/**
 * API event -> Game, where W/D/L are decimal odds for home win / draw / away
 * win. Books missing a three-way market (or any leg) are dropped, as are
 * fixtures left with no usable book.
 */
export function normalizeEvents(events: ApiEvent[] | null | undefined): Game[] {
  return (events || [])
    .map((ev) => {
      const books = (ev.bookmakers || [])
        .map((bk) => {
          const market = (bk.markets || []).find((m) => m.key === "h2h");
          if (!market) return null;
          const odds = { W: 0, D: 0, L: 0 };
          for (const out of market.outcomes || []) {
            if (out.name === ev.home_team) odds.W = out.price;
            else if (out.name === "Draw") odds.D = out.price;
            else if (out.name === ev.away_team) odds.L = out.price;
          }
          if (!(odds.W > 1 && odds.D > 1 && odds.L > 1)) return null;
          return { key: bk.key, title: bk.title, ...odds };
        })
        .filter((b): b is BookOdds => b !== null);
      return {
        id: ev.id,
        home: ev.home_team,
        away: ev.away_team,
        commence: ev.commence_time,
        books,
      };
    })
    .filter((g) => g.books.length > 0);
}
