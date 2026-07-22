// Turning a saved bet row into financial figures. Ported from betmaster's
// betStats.js so both apps settle bets identically. Shared by My Bets and Stats.

import type { Bet, BetRow } from "./supabase";

export const toNumber = (value: string | number | undefined | null): number => {
  const n = parseFloat(String(value));
  return Number.isFinite(n) ? n : 0;
};

export const fmt = (n: number): string =>
  (Number.isFinite(n) ? n : 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

/**
 * Net payout for a single winning scenario:
 *   gross      = stake * odds
 *   tax is charged on winnings only => taxAmount = (gross - stake) * taxRate
 *   netPayout  = gross - taxAmount
 */
export const scenarioNetPayout = (stake: number, odds: number, taxRate: number): number => {
  const gross = stake * odds;
  const taxAmount = (gross - stake) * taxRate;
  return gross - taxAmount;
};

/** Stored in `won_scenario` when the whole bet lost (no scenario won). */
export const LOST = "__LOST__";

export interface ComputedBet {
  rows: BetRow[];
  taxRate: number;
  totalStaked: number;
  settled: boolean;
  lost: boolean;
  returnAmount: number;
  netProfit: number;
  wonRow: BetRow | null;
}

/**
 * Derived figures for a bet. `won_scenario` marks it settled:
 *   null            -> pending
 *   LOST            -> settled, lost everything
 *   <scenario name> -> settled, that scenario won
 *
 * Note a bet can have a winning scenario and still be a net loss, when the
 * winner's return doesn't cover the stake spread across the other scenarios.
 */
export const computeBet = (bet: Pick<Bet, "rows" | "tax" | "won_scenario">): ComputedBet => {
  const rows = Array.isArray(bet.rows) ? bet.rows : [];
  const taxRate = toNumber(bet.tax);
  const totalStaked = rows.reduce((sum, r) => sum + toNumber(r.stake), 0);

  const settled = !!bet.won_scenario;
  const lost = bet.won_scenario === LOST;
  let returnAmount = 0;
  let netProfit = 0;
  let wonRow: BetRow | null = null;

  if (settled) {
    if (!lost) {
      wonRow = rows.find((r) => r.name === bet.won_scenario) ?? null;
      if (wonRow) {
        returnAmount = scenarioNetPayout(toNumber(wonRow.stake), toNumber(wonRow.odds), taxRate);
      }
    }
    netProfit = returnAmount - totalStaked;
  }

  return { rows, taxRate, totalStaked, settled, lost, returnAmount, netProfit, wonRow };
};

export const PERIODS = [
  { key: "7d", label: "7 days", days: 7 },
  { key: "30d", label: "30 days", days: 30 },
  { key: "90d", label: "90 days", days: 90 },
  { key: "all", label: "All time", days: null },
] as const;

export const withinPeriod = (createdAt: string, days: number | null): boolean => {
  if (!days) return true;
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return new Date(createdAt).getTime() >= cutoff;
};

/** Distinct, trimmed participant names on a bet (ignores empty placeholders). */
export const betTeamNames = (bet: Pick<Bet, "team_names">): string[] => {
  const names = Array.isArray(bet.team_names) ? bet.team_names : [];
  const seen = new Set<string>();
  names.forEach((n) => {
    const t = (n || "").trim();
    if (t) seen.add(t);
  });
  return [...seen];
};

const TEAM_LETTERS = ["A", "B", "C"];

/**
 * "AW + BL" -> "Arsenal W + Chelsea L" using the bet's saved participant names,
 * falling back to the letter when one was never named.
 */
export const labelScenario = (bet: Pick<Bet, "team_names">, scenario: string): string =>
  scenario
    .split(" + ")
    .map((tok) => {
      const idx = TEAM_LETTERS.indexOf(tok[0]);
      const names = Array.isArray(bet.team_names) ? bet.team_names : [];
      const nm = (names[idx] || "").trim();
      return `${nm || tok[0]} ${tok.slice(1)}`;
    })
    .join(" + ");

export interface TeamStat {
  team: string;
  bets: number;
  staked: number;
  settled: number;
  netProfit: number;
  wins: number;
  losses: number;
  winRate: number;
  roi: number;
}

/**
 * Per-team performance. Each bet's figures are attributed to EVERY participant
 * it names — "how do I do when this team is in my slip", not "what did this
 * team earn me". Column totals therefore exceed account totals, by design.
 */
export const aggregateByTeam = (
  computed: {
    bet: Pick<Bet, "team_names">;
    totalStaked: number;
    settled: boolean;
    netProfit: number;
  }[],
): TeamStat[] => {
  const map = new Map<string, Omit<TeamStat, "winRate" | "roi">>();
  computed.forEach((c) => {
    betTeamNames(c.bet).forEach((team) => {
      const e = map.get(team) ?? {
        team,
        bets: 0,
        staked: 0,
        settled: 0,
        netProfit: 0,
        wins: 0,
        losses: 0,
      };
      e.bets += 1;
      e.staked += c.totalStaked;
      if (c.settled) {
        e.settled += 1;
        e.netProfit += c.netProfit;
        if (c.netProfit > 0) e.wins += 1;
        else e.losses += 1;
      }
      map.set(team, e);
    });
  });
  return [...map.values()]
    .map((e) => ({
      ...e,
      winRate: e.settled > 0 ? (e.wins / e.settled) * 100 : 0,
      roi: e.staked > 0 ? (e.netProfit / e.staked) * 100 : 0,
    }))
    .sort((a, b) => b.netProfit - a.netProfit);
};

/** CSV download helper (browser only). */
export const downloadCSV = (filename: string, rows: (string | number)[][]): void => {
  const escape = (v: string | number) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = rows.map((r) => r.map(escape).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
};
