// Client-facing odds API. The paid key used to live here as
// VITE_ODDS_API_KEY, which Vite inlines into the browser bundle — anyone could
// read it out of devtools and spend the quota. Fetching now happens in server
// functions that call lib/odds-server.ts, so the key stays on the server and
// every user shares one cache instead of each spending their own credits.
//
// The types and normalizeEvents stay here because both halves need them.

import { createServerFn } from "@tanstack/react-start";

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

/**
 * Sports the scanner offers. Only sports with a genuine 3-way (W/D/L) market
 * belong here — the whole cover-bet pipeline prices three outcomes.
 */
export const SPORTS = [{ key: "soccer", label: "Football" }] as const;
export type SportKey = (typeof SPORTS)[number]["key"];

export interface OddsResponse {
  games: Game[];
  /** Credits left this month, straight from the response headers. */
  remaining: string | null;
  used: string | null;
}

export interface OddsResult extends OddsResponse {
  /** True when the server served this from cache, so no credits were spent. */
  cached: boolean;
  fetchedAt: number;
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
 * fixtures left with no usable book. Soccer's h2h is 3-way natively; other
 * sports arrive as the explicit h2h_3_way market — same shape, same handling.
 */
export function normalizeEvents(events: ApiEvent[] | null | undefined): Game[] {
  return (events || [])
    .map((ev) => {
      const books = (ev.bookmakers || [])
        .map((bk) => {
          const market = (bk.markets || []).find((m) => m.key === "h2h" || m.key === "h2h_3_way");
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

// ---------------------------------------------------------------- server fns
//
// The handlers below are stripped from the client bundle; the browser gets an
// RPC stub. lib/odds-server.ts is imported dynamically so it never enters the
// client module graph at all.

/** Whether the server has a key, so the UI can explain itself when it doesn't. */
export const oddsStatus = createServerFn({ method: "GET" }).handler(async () => {
  const { oddsKeyConfigured } = await import("./odds-server");
  return { configured: oddsKeyConfigured() };
});

export interface OddsRequest {
  accessToken: string;
  sportKey: string;
  regions: string;
  bookmakers?: string;
  from?: string;
  to?: string;
}

const leaguesFn = createServerFn({ method: "POST" })
  .inputValidator((d: { accessToken: string; sport: string }) => d)
  .handler(async ({ data }) => {
    const { loadLeagues, assertApprovedUser } = await import("./odds-server");
    await assertApprovedUser(data.accessToken);
    return loadLeagues(data.sport);
  });

const oddsFn = createServerFn({ method: "POST" })
  .inputValidator((d: OddsRequest) => d)
  .handler(async ({ data }) => {
    const { loadLeagueOdds, assertApprovedUser } = await import("./odds-server");
    // The proxy holds a paid key, so it must not be an open relay: only
    // signed-in, approved accounts can spend from the shared quota.
    await assertApprovedUser(data.accessToken);
    return loadLeagueOdds(
      data.sportKey,
      data.regions,
      data.bookmakers ?? "",
      data.from ?? "",
      data.to ?? "",
    );
  });

/**
 * Leagues currently in season for one sport. The /sports endpoint costs no
 * credits, but the result is cached server-side anyway so a room full of
 * users doesn't each trigger their own call.
 */
export async function fetchLeagues(accessToken: string, sport: SportKey): Promise<League[]> {
  return leaguesFn({ data: { accessToken, sport } });
}

/**
 * Head-to-head (1X2) odds for a league. Passing `bookmakers` (comma-separated
 * keys, e.g. "onexbet,betway") overrides the region and fetches exactly those
 * books — cheaper too. Optional `from`/`to` (ISO, no milliseconds) restrict
 * results to fixtures commencing in that window.
 *
 * Identical requests inside the cache window are served without touching the
 * upstream API, so `cached: true` means no credits were spent.
 */
export async function fetchLeagueOdds(
  accessToken: string,
  sportKey: string,
  regions: string,
  bookmakers = "",
  from = "",
  to = "",
): Promise<OddsResult> {
  return oddsFn({ data: { accessToken, sportKey, regions, bookmakers, from, to } });
}

/** Server-held key presence, for disabling the scan controls with a reason. */
export async function fetchOddsConfigured(): Promise<boolean> {
  const { configured } = await oddsStatus();
  return configured;
}
