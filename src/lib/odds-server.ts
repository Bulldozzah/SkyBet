// Server-only half of the odds pipeline. This module must never reach the
// browser: it holds the paid API key and is the only place that talks to
// The Odds API.
//
// Two problems it solves.
//
// 1. The key. It used to be VITE_ODDS_API_KEY, which Vite inlines into the
//    client bundle — anyone could read it out of devtools and spend the quota.
//    It is now ODDS_API_KEY with no VITE_ prefix, so Vite will not expose it to
//    client code even by accident.
//
// 2. The quota. The free tier is 500 credits/month and every client used to
//    fetch independently, so N users scanning the same league cost N times the
//    credits for identical data. Responses are now cached and concurrent
//    requests for the same URL are coalesced into one upstream call, which
//    turns cost-per-user into cost-per-interval.

import { createServerOnlyFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { normalizeEvents, type Game, type League, type OddsResponse } from "./odds-api";

const BASE = "https://api.the-odds-api.com/v4";

/** Prices move, but not second to second — a few minutes is plenty. */
const ODDS_TTL_MS = 3 * 60 * 1000;
/** The in-season league list barely changes, and /sports costs no credits. */
const LEAGUES_TTL_MS = 6 * 60 * 60 * 1000;
/** Stop the map growing without bound in a long-lived isolate. */
const MAX_ENTRIES = 200;

const readKey = createServerOnlyFn(() => process.env.ODDS_API_KEY ?? "");

export const oddsKeyConfigured = (): boolean => readKey().length > 0;

interface Entry<T> {
  value: T;
  expiresAt: number;
  /** When the upstream call happened, so callers can show scan age. */
  fetchedAt: number;
}

// Per-isolate memo. Cloudflare keeps isolates warm and reuses them across
// requests, so this absorbs most repeat traffic on its own.
const memo = new Map<string, Entry<unknown>>();
// Requests currently in flight, so a burst of users asking for the same league
// at the same moment produces exactly one upstream call.
const inFlight = new Map<string, Promise<unknown>>();

const prune = () => {
  const now = Date.now();
  for (const [k, v] of memo) if (v.expiresAt <= now) memo.delete(k);
  if (memo.size <= MAX_ENTRIES) return;
  // Still oversized: drop oldest-first until back under the cap.
  const byAge = [...memo.entries()].sort((a, b) => a[1].fetchedAt - b[1].fetchedAt);
  for (const [k] of byAge.slice(0, memo.size - MAX_ENTRIES)) memo.delete(k);
};

/**
 * Cache-aside with in-flight coalescing. `cached` tells the caller whether the
 * value came from cache, so the UI can be honest about whether credits moved.
 */
async function cached<T>(
  key: string,
  ttlMs: number,
  load: () => Promise<T>,
): Promise<{ value: T; cached: boolean; fetchedAt: number }> {
  const now = Date.now();
  const hit = memo.get(key) as Entry<T> | undefined;
  if (hit && hit.expiresAt > now) {
    return { value: hit.value, cached: true, fetchedAt: hit.fetchedAt };
  }

  const pending = inFlight.get(key) as Promise<T> | undefined;
  if (pending) {
    // Someone else is already fetching this exact URL — wait on theirs rather
    // than spending a second credit on the same data.
    return { value: await pending, cached: true, fetchedAt: now };
  }

  const task = load();
  inFlight.set(key, task);
  try {
    const value = await task;
    memo.set(key, { value, expiresAt: Date.now() + ttlMs, fetchedAt: Date.now() });
    prune();
    return { value, cached: false, fetchedAt: Date.now() };
  } finally {
    inFlight.delete(key);
  }
}

/**
 * The proxy spends from a paid quota, so it must not be an open relay: without
 * this, moving the key server-side would only change who can waste it. Throws
 * unless the caller presents a valid session for an approved account.
 *
 * The Supabase client is built with the caller's own token, so the profile read
 * runs under their row-level-security policies — no service_role key involved
 * and no privileges widened.
 */
export async function assertApprovedUser(accessToken: string): Promise<void> {
  if (!accessToken) throw new Error("Sign in to use the scanner.");

  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  if (!url || !anon) throw new Error("Server is missing its Supabase configuration.");

  const client = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });

  const { data, error } = await client.auth.getUser(accessToken);
  if (error || !data.user) throw new Error("Your session has expired — sign in again.");

  const { data: profile } = await client
    .from("profiles")
    .select("role,status")
    .eq("id", data.user.id)
    .single();

  // Admins are implicitly approved — role outranks status, as everywhere else.
  const approved = profile?.role === "admin" || profile?.status === "approved";
  if (!approved) throw new Error("Your account is not approved yet.");
}

const apiError = async (res: Response): Promise<string> => {
  try {
    const body = (await res.json()) as { message?: string };
    return body.message || `${res.status} ${res.statusText}`;
  } catch {
    return `${res.status} ${res.statusText}`;
  }
};

/** Upstream errors must not leak the key, which is embedded in the URL. */
const scrub = (message: string, key: string): string =>
  key ? message.split(key).join("<redacted>") : message;

// Sports the scanner exposes, mapped to the /sports endpoint's group names.
// Everything here must price as a 3-way (W/D/L) market — that is the only
// shape the cover-bet math understands. Soccer's plain h2h is already 3-way;
// any future non-soccer sport gets the explicit h2h_3_way market — see
// marketForSport below.
const SPORT_GROUPS: Record<string, string> = {
  soccer: "Soccer",
};

export async function loadLeagues(sport: string): Promise<League[]> {
  const group = SPORT_GROUPS[sport];
  if (!group) throw new Error(`Unknown sport: ${sport}`);
  const key = readKey();
  if (!key) throw new Error("The odds API key is not configured on the server.");

  const { value } = await cached<League[]>(`leagues:${sport}`, LEAGUES_TTL_MS, async () => {
    const res = await fetch(`${BASE}/sports/?apiKey=${key}`);
    if (!res.ok) throw new Error(scrub(await apiError(res), key));
    const all = (await res.json()) as {
      key: string;
      title: string;
      group: string;
      active: boolean;
      has_outrights: boolean;
    }[];
    // Outright entries ("NHL Championship Winner", "Super Bowl Winner") are
    // futures with no fixtures, so a scan of them can only return nothing.
    // Inactive means off-season: the API serves no odds for those either, and
    // they reappear here automatically when their season starts.
    return all
      .filter((s) => s.group === group && s.active && !s.has_outrights)
      .map((s) => ({ key: s.key, title: s.title }));
  });
  return value;
}

/**
 * Which market to request for a league. Derived server-side from the sport
 * key rather than trusted from the client, so nothing can request the 2-way
 * moneyline the math cannot price. Sport keys from the API are prefixed
 * (soccer_epl, icehockey_nhl, americanfootball_nfl, ...).
 */
const marketForSport = (sportKey: string): string =>
  sportKey.startsWith("soccer") ? "h2h" : "h2h_3_way";

export interface CachedOdds extends OddsResponse {
  /** True when no upstream call was made, so no credits were spent. */
  cached: boolean;
  fetchedAt: number;
}

export async function loadLeagueOdds(
  sportKey: string,
  regions: string,
  bookmakers = "",
  from = "",
  to = "",
): Promise<CachedOdds> {
  const key = readKey();
  if (!key) throw new Error("The odds API key is not configured on the server.");

  const selector = bookmakers ? `bookmakers=${bookmakers}` : `regions=${regions}`;
  const window =
    (from ? `&commenceTimeFrom=${encodeURIComponent(from)}` : "") +
    (to ? `&commenceTimeTo=${encodeURIComponent(to)}` : "");
  // The cache key deliberately excludes the API key: it identifies the data,
  // not the caller, so every user shares one entry.
  const path = `${BASE}/sports/${sportKey}/odds/?${selector}&markets=${marketForSport(
    sportKey,
  )}&oddsFormat=decimal${window}`;

  const {
    value,
    cached: fromCache,
    fetchedAt,
  } = await cached<Omit<OddsResponse, never>>(path, ODDS_TTL_MS, async () => {
    const res = await fetch(`${path}&apiKey=${key}`);
    if (!res.ok) throw new Error(scrub(await apiError(res), key));
    return {
      games: normalizeEvents(await res.json()) as Game[],
      remaining: res.headers.get("x-requests-remaining"),
      used: res.headers.get("x-requests-used"),
    };
  });

  return { ...value, cached: fromCache, fetchedAt };
}
