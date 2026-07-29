// Value maths for the Test workbench: what a cover bet is *worth*, as opposed
// to what it pays on the occasions it lands.
//
// The Scanner ranks on profitPct (the payout conditional on landing) and on
// exclProb (how often it lands). Both look like good news and neither is
// expected value — and because they trade off against each other exactly,
// neither one alone tells you whether a bet is worth taking.
//
// Write S for the summed inverse odds over all 3^n scenarios and r for the
// excluded scenario's 1/odds. Dutching the rest returns 1/Sx per unit staked
// where Sx = S - r, and the excluded scenario's margin-normalized chance is
// r/S, so the expected return per unit is
//
//   EV = (1 - r/S) * 1/(S - r) = ((S - r)/S) * 1/(S - r) = 1/S
//
// The r cancels. Expected return depends only on the total overround — not on
// which scenario you drop, nor on whether you drop one at all. Coverage is a
// variance dial, not an edge dial.
//
// And since S is the product of each leg's overround, every extra leg
// multiplies in another bookmaker margin. That is the whole reason a 1-game
// cover beats a 2-game cover at a comparable hit rate, and it is the one
// structural lever available without better prices.

import type { Game } from "./odds-api";
import { invSum, excludePatternKey, type OddsTriple } from "./scanner";
import { scenarioNetPayout, toNumber } from "./bet-stats";
import type { BetRow } from "./supabase";

/** One market's overround as a percentage: 1.0342 -> 3.42. */
export const overroundPct = (odds: OddsTriple): number => (invSum(odds) - 1) * 100;

/** S for a combo — the product of each leg's overround. */
export const combinedS = (oddsList: OddsTriple[]): number =>
  oddsList.reduce((acc, o) => acc * invSum(o), 1);

/**
 * Expected return per 100 staked, whatever coverage is chosen on top. Above
 * 100 is a genuine edge (an arb); below 100 is what you hand the book per
 * unit of turnover.
 */
export const expectedPer100 = (oddsList: OddsTriple[]): number => 100 / combinedS(oddsList);

/** Tightest market a game offers at one book, and across all of them. */
export interface MarketMargin {
  game: Game;
  /** Overround on best odds across every book — the floor available. */
  bestPct: number;
  /** Overround at the single tightest bookmaker — placeable on one slip. */
  singlePct: number;
  singleBook: string;
  books: number;
}

export const marketMargin = (game: Game): MarketMargin | null => {
  if (game.books.length === 0) return null;
  const best: OddsTriple = { W: 0, D: 0, L: 0 };
  for (const bk of game.books) {
    if (bk.W > best.W) best.W = bk.W;
    if (bk.D > best.D) best.D = bk.D;
    if (bk.L > best.L) best.L = bk.L;
  }
  let singlePct = Infinity;
  let singleBook = "";
  for (const bk of game.books) {
    const pct = overroundPct(bk);
    if (pct < singlePct) {
      singlePct = pct;
      singleBook = bk.title;
    }
  }
  return {
    game,
    bestPct: overroundPct(best),
    singlePct,
    singleBook,
    books: game.books.length,
  };
};

export interface RowsEv {
  totalStaked: number;
  /** Probability-weighted return across every scenario, tax included. */
  expectedReturn: number;
  expectedProfit: number;
  /** Expected profit as a percentage of stake. Negative is the normal case. */
  expectedRoi: number;
  /** Chance the bet returns more than it cost — the real "chance of winning". */
  winProb: number;
  S: number;
}

/**
 * Exact expected value of an arbitrary staking plan, straight from stored
 * scenario rows.
 *
 * Scenario i occurs with margin-normalized chance (1/o_i)/S and returns that
 * row's net payout while every other stake is lost, so
 *   E[return] = SUM_i p_i * netPayout(stake_i, odds_i, tax)
 *
 * The closed form 1/S assumes perfect dutching and no tax; this does not, so
 * it stays correct for hand-edited stakes, excluded rows (stake 0) and any
 * tax rate — which is what saved bets actually look like.
 */
export const evaluateRows = (rows: BetRow[], tax: number): RowsEv | null => {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const odds = rows.map((r) => toNumber(r.odds));
  if (odds.some((o) => !(o > 1))) return null;

  const S = odds.reduce((acc, o) => acc + 1 / o, 0);
  const totalStaked = rows.reduce((acc, r) => acc + toNumber(r.stake), 0);

  let expectedReturn = 0;
  let winProb = 0;
  rows.forEach((row, i) => {
    const p = 1 / odds[i] / S;
    const stake = toNumber(row.stake);
    const payout = stake > 0 ? scenarioNetPayout(stake, odds[i], toNumber(tax)) : 0;
    expectedReturn += p * payout;
    if (payout > totalStaked) winProb += p;
  });

  return {
    totalStaked,
    expectedReturn,
    expectedProfit: expectedReturn - totalStaked,
    expectedRoi: totalStaked > 0 ? ((expectedReturn - totalStaked) / totalStaked) * 100 : 0,
    winProb,
    S,
  };
};

/**
 * Where the independence assumption is shakiest.
 *
 * exclProb multiplies each game's implied probabilities, which is only valid
 * when the games are independent. Shared competition or a shared kickoff makes
 * the excluded scenario *more* likely than the product suggests, so the shown
 * hit rate is optimistic in exactly the direction that costs money.
 */
export const correlationNote = (games: Game[]): string | null => {
  if (games.length < 2) return null;
  const leagues = games.map((g) => g.league || "").filter(Boolean);
  const sameLeague = leagues.length > 1 && new Set(leagues).size < leagues.length;
  const times = games.map((g) => new Date(g.commence).getTime()).filter((t) => Number.isFinite(t));
  const spreadHours =
    times.length > 1 ? (Math.max(...times) - Math.min(...times)) / 3_600_000 : Infinity;
  const together = spreadHours < 2;

  if (sameLeague && together) return "Same competition, kickoffs within 2h";
  if (sameLeague) return "Same competition";
  if (together) return "Kickoffs within 2h";
  return null;
};

/**
 * Whether a result survives the uncovered-scenario filter.
 *
 * Pattern keys only apply to their own structure size, so selecting a 2-game
 * pattern leaves 1- and 3-game rows unfiltered — the Scanner's rule, extended
 * across the leg counts the workbench shows together. Full covers have no
 * uncovered scenario and always stay: guaranteed profit should never be hidden
 * by a risk filter.
 */
export const matchesExclFilter = (
  filter: string[],
  legs: number,
  excludeLabel: string | null,
  fullCover: boolean,
): boolean => {
  const applicable = filter.filter((k) => k.length === legs);
  if (applicable.length === 0) return true;
  if (fullCover) return true;
  return !!excludeLabel && applicable.includes(excludePatternKey(excludeLabel));
};

/** Signed percentage, e.g. "+3.42%" / "-9.31%". */
export const signedPct = (n: number, dp = 2): string => `${n >= 0 ? "+" : ""}${n.toFixed(dp)}%`;
