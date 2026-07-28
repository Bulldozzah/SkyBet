// The Scanner caches its last scan in localStorage so navigating away (or
// reloading) doesn't throw away results that cost API credits. The Test
// workbench reads that same cache instead of scanning again — every figure it
// shows is derived from odds already paid for.
//
// The Scanner owns the write side and its own richer view of this object; this
// module exists so the storage key lives in exactly one place.

import type { Game } from "./odds-api";

export const SCAN_CACHE_KEY = "scanner-cache";

/** The read-only slice of the Scanner's cache the workbench needs. */
export interface CachedScan {
  games: Game[];
  /** Which Scanner tab produced these. */
  tab: "league" | "date";
  /** "live" or "demo" — date scans are always live. */
  source: string;
  scannedAt: number | null;
}

interface RawCache {
  scanTab?: string;
  games?: Game[] | null;
  dateGames?: Game[] | null;
  source?: string;
  scannedAt?: number | null;
  dateScannedAt?: number | null;
}

/** Null when there is no usable cached scan (including during SSR). */
export const readScanCache = (): CachedScan | null => {
  if (typeof window === "undefined") return null;
  try {
    const raw = JSON.parse(localStorage.getItem(SCAN_CACHE_KEY) ?? "null") as RawCache | null;
    if (!raw || typeof raw !== "object") return null;

    const tab = raw.scanTab === "date" ? "date" : "league";
    const games = tab === "date" ? raw.dateGames : raw.games;
    if (!Array.isArray(games) || games.length === 0) return null;

    return {
      games,
      tab,
      source: tab === "date" ? "live" : (raw.source ?? ""),
      scannedAt: (tab === "date" ? raw.dateScannedAt : raw.scannedAt) ?? null,
    };
  } catch {
    return null;
  }
};
