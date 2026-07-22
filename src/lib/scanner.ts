// Scanner maths: find n-game scenario combos where dutching the 3^n outcome
// products — minus at most one excluded scenario — clears a minimum profit.
//
// For two games with W/D/L odds a and b, scenario (i,j) has odds a_i * b_j.
// Equal-profit dutching over a set of scenarios with total stake T pays
// T / S where S = sum of 1/odds over the set, so profit% = 1/S - 1.
// Covering all 9 at one bookmaker always has S > 1 (the book's margin,
// squared), so the play is excluding exactly one scenario: the smaller the
// excluded scenario's 1/odds, the safer the exclusion — but the lower the
// profit. Every exclusion clearing the profit floor is surfaced, safest first.

import type { BookOdds, Game } from "./odds-api";
import type { BetRow, LoadableBet } from "./supabase";

export const OUTCOMES = ["W", "D", "L"] as const;
export type Outcome = (typeof OUTCOMES)[number];

const TEAM_LETTERS = ["A", "B", "C"];

/** Odds triple for one game — the shape both scan modes reduce to. */
export type OddsTriple = { W: number; D: number; L: number };

/**
 * Scenario labels for n games in the same row order the Calculator uses: the
 * last game cycles fastest (cartesian product). n=2 -> "A? + B?".
 */
export const comboScenarios = (n: number): string[] => {
  let combos: string[] = [""];
  for (let t = 0; t < n; t++) {
    const next: string[] = [];
    for (const c of combos) {
      for (const o of OUTCOMES) {
        next.push(c ? `${c} + ${TEAM_LETTERS[t]}${o}` : `${TEAM_LETTERS[t]}${o}`);
      }
    }
    combos = next;
  }
  return combos;
};

/** Same row order the Calculator's 2-team tab uses (team B cycles fastest). */
export const PAIR_SCENARIOS = comboScenarios(2);

const invSum = (o: OddsTriple): number => 1 / o.W + 1 / o.D + 1 / o.L;

/** Margin-normalized probability of one outcome ("implied chance"). */
const impliedProb = (odds: OddsTriple, o: Outcome): number => 1 / odds[o] / invSum(odds);

/** Best odds per outcome across a game's bookmakers, remembering the book. */
export const bestOdds = (game: Game): { odds: OddsTriple; books: Record<Outcome, string> } => {
  const odds: OddsTriple = { W: 0, D: 0, L: 0 };
  const books: Record<Outcome, string> = { W: "", D: "", L: "" };
  for (const bk of game.books) {
    for (const o of OUTCOMES) {
      if (bk[o] > odds[o]) {
        odds[o] = bk[o];
        books[o] = bk.title;
      }
    }
  }
  return { odds, books };
};

export interface ComboEval {
  excludeIdx: number;
  excludeLabel: string | null;
  profitPct: number;
  exclProb: number;
  /** True arbitrage — every scenario profits. Cross-book mode only. */
  fullCover: boolean;
  scenarioOdds: number[];
}

export interface ComboResult extends ComboEval {
  games: Game[];
  gamesOdds: OddsTriple[];
  bookLabel: string;
}

/**
 * Evaluate one combo of n odds triples (n = 2 or 3). Returns null when nothing
 * clears `minPct`; otherwise the safest qualifying play.
 */
export const evalCombo = (oddsList: OddsTriple[], minPct: number): ComboEval | null => {
  const n = oddsList.length;
  const scenarios = comboScenarios(n);
  const total = scenarios.length; // 3^n
  // Outcome index of team t for scenario idx (last team cycles fastest).
  const outcomeAt = (idx: number, t: number): Outcome =>
    OUTCOMES[Math.floor(idx / Math.pow(3, n - 1 - t)) % 3];

  const scenarioOdds: number[] = [];
  let S = 0;
  for (let idx = 0; idx < total; idx++) {
    let o = 1;
    for (let t = 0; t < n; t++) o *= oddsList[t][outcomeAt(idx, t)];
    scenarioOdds.push(o);
    S += 1 / o;
  }

  const target = 1 / (1 + minPct / 100); // need S <= this for profit >= minPct

  if (S <= target) {
    return {
      excludeIdx: -1,
      excludeLabel: null,
      profitPct: (1 / S - 1) * 100,
      exclProb: 0,
      fullCover: true,
      scenarioOdds,
    };
  }

  // Try each single exclusion; among those clearing minPct keep the one whose
  // excluded scenario is least likely to actually happen.
  let best: ComboEval | null = null;
  scenarios.forEach((label, idx) => {
    const Sx = S - 1 / scenarioOdds[idx];
    if (Sx > target) return;
    let exclProb = 1;
    for (let t = 0; t < n; t++) exclProb *= impliedProb(oddsList[t], outcomeAt(idx, t));
    if (!best || exclProb < best.exclProb) {
      best = {
        excludeIdx: idx,
        excludeLabel: label,
        profitPct: (1 / Sx - 1) * 100,
        exclProb,
        fullCover: false,
        scenarioOdds,
      };
    }
  });
  return best;
};

export interface ArbResult {
  game: Game;
  odds: OddsTriple;
  books: Record<Outcome, string>;
  profitPct: number;
}

/**
 * Single-game 3-way arbitrage across bookmakers: dutch W/D/L at the best
 * available odds; profitable when the summed inverse odds drop below 1.
 */
export const evalSingleGameArb = (game: Game, minPct: number): ArbResult | null => {
  const { odds, books } = bestOdds(game);
  const S = invSum(odds);
  const profitPct = (1 / S - 1) * 100;
  if (profitPct < minPct) return null;
  return { game, odds, books, profitPct };
};

/**
 * All n-sized combinations of indices [0..len) as arrays. Order is
 * lexicographic so results stay stable between renders.
 */
const combinations = (len: number, n: number): number[][] => {
  const out: number[][] = [];
  const pick = (start: number, acc: number[]) => {
    if (acc.length === n) {
      out.push(acc.slice());
      return;
    }
    for (let i = start; i < len; i++) {
      acc.push(i);
      pick(i + 1, acc);
      acc.pop();
    }
  };
  pick(0, []);
  return out;
};

export type ScanMode = "single" | "cross";

/**
 * Scan every n-game combo (n = 2 for pairs, 3 for triples).
 *   'single' — odds from ONE bookmaker held across all games in the combo,
 *              i.e. a slip you can actually place at that book.
 *   'cross'  — best odds per outcome across all books (legs placed at
 *              different books). Only this mode can yield full cover.
 * Returns safest-first.
 */
export const scanCombos = (
  games: Game[],
  mode: ScanMode,
  minPct: number,
  teamCount = 2,
): ComboResult[] => {
  const results: ComboResult[] = [];
  for (const combo of combinations(games.length, teamCount)) {
    const gs = combo.map((i) => games[i]);
    if (mode === "single") {
      // Only bookmakers present on every game in the combo can carry the slip.
      for (const bkFirst of gs[0].books) {
        const gamesOdds: BookOdds[] = [bkFirst];
        let ok = true;
        for (let t = 1; t < gs.length; t++) {
          const bk = gs[t].books.find((b) => b.key === bkFirst.key);
          if (!bk) {
            ok = false;
            break;
          }
          gamesOdds.push(bk);
        }
        if (!ok) continue;
        const r = evalCombo(gamesOdds, minPct);
        if (r) results.push({ ...r, games: gs, gamesOdds, bookLabel: bkFirst.title });
      }
    } else {
      const best = gs.map((g) => bestOdds(g));
      const r = evalCombo(
        best.map((b) => b.odds),
        minPct,
      );
      if (r) {
        const books = new Set(best.flatMap((b) => Object.values(b.books)));
        results.push({
          ...r,
          games: gs,
          gamesOdds: best.map((b) => b.odds),
          bookLabel: [...books].join(" · "),
        });
      }
    }
  }
  // Safest first: full arbs on top, then lowest chance of the excluded
  // scenario hitting; profit breaks ties.
  return results.sort((a, b) => {
    if (a.fullCover !== b.fullCover) return a.fullCover ? -1 : 1;
    if (a.exclProb !== b.exclProb) return a.exclProb - b.exclProb;
    return b.profitPct - a.profitPct;
  });
};

/**
 * Round dutched stakes to cents, dropping the remainder on the largest so the
 * total stays exactly T (mirrors the Calculator's roundStakes).
 */
const dutchStakes = (oddsList: number[], includedIdx: number[], T: number): number[] => {
  const S = includedIdx.reduce((a, i) => a + 1 / oddsList[i], 0);
  const stakes = oddsList.map(() => 0);
  includedIdx.forEach((i) => {
    stakes[i] = Math.round((T / (oddsList[i] * S)) * 100) / 100;
  });
  const iMax = includedIdx.reduce((m, i) => (stakes[i] > stakes[m] ? i : m), includedIdx[0]);
  const diff = T - stakes.reduce((a, b) => a + b, 0);
  stakes[iMax] = Math.round((stakes[iMax] + diff) * 100) / 100;
  return stakes;
};

/** A scanner pick, in the shape the Calculator loads. */
export type ScannerBet = LoadableBet;

/**
 * Build the bet object the Calculator expects for a scanned combo (2 or 3
 * games). `outcome_odds` carries each game's individual W/D/L odds so the
 * Calculator's per-participant inputs are filled in too.
 */
export const buildComboBet = (result: ComboResult, targetStake = 100): ScannerBet => {
  const { games, gamesOdds, scenarioOdds, excludeIdx } = result;
  const n = games.length;
  const includedIdx = scenarioOdds.map((_, i) => i).filter((i) => i !== excludeIdx);
  const stakes = dutchStakes(scenarioOdds, includedIdx, targetStake);
  return {
    team_count: n,
    tax: 0,
    target_stake: targetStake,
    team_names: games.map((g) => g.home),
    outcome_odds: gamesOdds.map((o) => ({
      W: String(o.W),
      D: String(o.D),
      L: String(o.L),
    })),
    title: `Scanner: ${games.map((g) => `${g.home} v ${g.away}`).join(" + ")}`,
    games: games.map((g) => ({ home: g.home, away: g.away, league: g.league })),
    rows: comboScenarios(n).map((name, i): BetRow => ({
      name,
      stake: String(stakes[i]),
      odds: String(Math.round(scenarioOdds[i] * 100) / 100),
      excluded: i === excludeIdx,
    })),
  };
};

/** Same, for a single-game cross-book arb (the Calculator's 1-team tab). */
export const buildArbBet = (arb: ArbResult, targetStake = 100): ScannerBet => {
  const oddsList = OUTCOMES.map((o) => arb.odds[o]);
  const stakes = dutchStakes(oddsList, [0, 1, 2], targetStake);
  return {
    team_count: 1,
    tax: 0,
    target_stake: targetStake,
    team_names: [arb.game.home],
    title: `Scanner arb: ${arb.game.home} v ${arb.game.away}`,
    games: [{ home: arb.game.home, away: arb.game.away, league: arb.game.league }],
    rows: OUTCOMES.map((o, i): BetRow => ({
      name: `A${o}`,
      stake: String(stakes[i]),
      odds: String(oddsList[i]),
    })),
  };
};
