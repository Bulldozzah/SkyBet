// Cover-betting maths, ported verbatim from betmaster so both apps agree to
// the cent. See FUNCTIONAL-SPEC.md §3 and §10 for the derivations.

export type Outcome = "W" | "D" | "L";

export const OUTCOMES: Outcome[] = ["W", "D", "L"];
export const OUTCOME_LABELS: Record<Outcome, string> = {
  W: "Win",
  D: "Draw",
  L: "Loss",
};
export const TEAM_LETTERS = ["A", "B", "C"];
export const TEAM_TABS = [1, 2, 3] as const;
export type TeamTab = (typeof TEAM_TABS)[number];

export interface Sport {
  id: string;
  label: string;
  /** What one participant is called in this sport. */
  side: string;
  icon: string;
}

// Head-to-head sports only (two sides per event) — the W/D/L scenario logic
// applies to all of them.
export const SPORTS: Sport[] = [
  { id: "football", label: "Football", side: "Team", icon: "⚽" },
  { id: "basketball", label: "Basketball", side: "Team", icon: "🏀" },
  { id: "tennis", label: "Tennis", side: "Player", icon: "🎾" },
  { id: "hockey", label: "Hockey", side: "Team", icon: "🏒" },
  { id: "cricket", label: "Cricket", side: "Team", icon: "🏏" },
  { id: "rugby", label: "Rugby", side: "Team", icon: "🏉" },
  { id: "american-football", label: "American Football", side: "Team", icon: "🏈" },
  { id: "volleyball", label: "Volleyball", side: "Team", icon: "🏐" },
  { id: "ufc", label: "UFC", side: "Fighter", icon: "🥋" },
  { id: "boxing", label: "Boxing", side: "Fighter", icon: "🥊" },
];

export interface Row {
  /** Canonical scenario name, e.g. "AW + BL". The ordering contract. */
  name: string;
  stake: string;
  odds: string;
  excluded?: boolean;
}

export interface OutcomeOddsInput {
  W: string;
  D: string;
  L: string;
}

/**
 * Scenario names for n events, last event cycling fastest (base-3 counting).
 * Row i takes team t's outcome from OUTCOMES[floor(i / 3^(n-1-t)) % 3].
 */
export const buildScenarios = (numTeams: number): string[] => {
  const letters = TEAM_LETTERS.slice(0, numTeams);
  let combos: Outcome[][] = [[]];
  for (let t = 0; t < numTeams; t++) {
    const next: Outcome[][] = [];
    for (const combo of combos) {
      for (const outcome of OUTCOMES) next.push([...combo, outcome]);
    }
    combos = next;
  }
  return combos.map((outs) => outs.map((o, i) => letters[i] + o).join(" + "));
};

export const makeRows = (numTeams: number): Row[] =>
  buildScenarios(numTeams).map((name) => ({ name, stake: "0", odds: "0" }));

export const makeNames = (numTeams: number): string[] => Array.from({ length: numTeams }, () => "");

export const makeOutcomeOdds = (numTeams: number): OutcomeOddsInput[] =>
  Array.from({ length: numTeams }, () => ({ W: "", D: "", L: "" }));

/** Unparseable / empty input reads as 0 so typing never breaks the page. */
export const toNumber = (value: string | number | undefined | null): number => {
  const n = parseFloat(String(value));
  return Number.isFinite(n) ? n : 0;
};

export const fmt = (n: number): string =>
  (Number.isFinite(n) ? n : 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

/** Plural-aware participant word: "Team" / "Teams", "Fighter" / "Fighters". */
export const sideWord = (sport: Sport, n: number): string =>
  n === 1 ? sport.side : `${sport.side}s`;

/**
 * Scenario odds = product of each event's outcome odds, for every row at once.
 * Row i takes team t's outcome from index floor(i / 3^(n-1-t)) % 3.
 */
export const deriveScenarioOdds = (
  outcomeOdds: OutcomeOddsInput[],
  numTeams: number,
  rowCount: number,
): string[] => {
  const out: string[] = [];
  for (let i = 0; i < rowCount; i++) {
    let odds = 1;
    for (let t = 0; t < numTeams; t++) {
      const k = Math.floor(i / Math.pow(3, numTeams - 1 - t)) % 3;
      odds *= toNumber(outcomeOdds[t]?.[OUTCOMES[k]]);
    }
    out.push(String(Math.round(odds * 100) / 100));
  }
  return out;
};

export interface RowResult {
  gross: number;
  netPayout: number;
  profit: number;
  covered: boolean;
  /** Extra stake needed to break even; null when covered or odds <= 1. */
  minToCover: number | null;
  /** Whether minToCover fits inside the remaining budget. */
  affordable: boolean;
  profitPct: number;
}

export interface ComputeResult {
  totalStake: number;
  remaining: number;
  results: RowResult[];
}

/**
 * Per-row figures for the whole table.
 *   gross      = stake * odds
 *   netPayout  = gross - (gross - stake) * taxRate   (tax on winnings only)
 *   profit     = netPayout - total staked across ALL rows
 *   covered    = gross >= total staked
 *   minToCover = (total - gross) / (odds - 1)        (odds > 1 only)
 */
export const computeRows = (
  rows: Row[],
  tax: string | number,
  targetStake: string | number,
): ComputeResult => {
  const taxRate = toNumber(tax);
  const budget = toNumber(targetStake);
  const total = rows.reduce((sum, row) => sum + toNumber(row.stake), 0);
  const remaining = budget - total;

  const results = rows.map((row) => {
    const stake = toNumber(row.stake);
    const odds = toNumber(row.odds);
    const gross = stake * odds;
    const taxAmount = (gross - stake) * taxRate;
    const netPayout = gross - taxAmount;
    const profit = netPayout - total;
    const covered = total <= gross;

    let minToCover: number | null = null;
    let affordable = false;
    if (!covered && odds > 1) {
      minToCover = (total - gross) / (odds - 1);
      affordable = minToCover <= remaining;
    }

    // Percentage of the committed budget, not of gross — under Balance win
    // profit and gross scale together so their ratio would never move.
    const pctBase = budget > 0 ? budget : total;
    const profitPct = pctBase > 0 ? (profit / pctBase) * 100 : 0;

    return { gross, netPayout, profit, covered, minToCover, affordable, profitPct };
  });

  return { totalStake: total, remaining, results };
};

/** Rows eligible for staking: odds > 1 and not excluded by the user. */
export const stakeableIdx = (rows: Row[]): number[] =>
  rows.map((row, i) => (toNumber(row.odds) > 1 && !row.excluded ? i : -1)).filter((i) => i >= 0);

/**
 * Round to cents, then drop the whole rounding remainder on the largest stake
 * so the total is exactly T.
 */
export const roundStakes = (raw: number[], validIdx: number[], T: number): number[] => {
  const factor = 100;
  const stakes = raw.map((v) => Math.round(v * factor) / factor);
  let idxMax = -1;
  let max = -Infinity;
  validIdx.forEach((i) => {
    if (stakes[i] > max) {
      max = stakes[i];
      idxMax = i;
    }
  });
  if (idxMax >= 0) {
    const diff = Math.round((T - stakes.reduce((a, b) => a + b, 0)) * factor) / factor;
    stakes[idxMax] = Math.round((stakes[idxMax] + diff) * factor) / factor;
  }
  return stakes;
};

/**
 * Equal-profit dutching: stake_i proportional to 1/m_i where
 * m_i = odds*(1-tax) + tax, so every included scenario nets the same payout.
 * Returns null when there is nothing to stake.
 */
export const balanceProfitStakes = (
  rows: Row[],
  tax: string | number,
  targetStake: string | number,
): number[] | null => {
  const T = toNumber(targetStake);
  const taxRate = toNumber(tax);
  if (!(T > 0)) return null;

  const m = rows.map((row) => toNumber(row.odds) * (1 - taxRate) + taxRate);
  const validIdx = stakeableIdx(rows);
  if (validIdx.length === 0) return null;

  const sumInv = validIdx.reduce((a, i) => a + 1 / m[i], 0);
  const raw = rows.map(() => 0);
  validIdx.forEach((i) => {
    raw[i] = T / m[i] / sumInv;
  });
  return roundStakes(raw, validIdx, T);
};

/** "AW + BD" -> "W+D" — the shorthand the give-up dropdown is labelled with. */
export const scenarioCode = (scenario: string): string =>
  scenario
    .split(" + ")
    .map((tok) => tok.slice(1))
    .join("+");

export interface CoverPlan {
  /** Row left unstaked, or null when every stakeable scenario is covered. */
  sacrifice: number | null;
  /** How many scenarios end up carrying a stake. */
  coveredCount: number;
  /** What each covered scenario nets, in currency. */
  profit: number;
  /** ...as a percentage of the budget, matching the table's Profit % column. */
  profitPct: number;
}

/**
 * What every choice of "which scenario do I give up" is worth, so the answer
 * can be compared before committing to one.
 *
 * Under equal-profit dutching over a covered set C, each covered scenario nets
 * T/S where S = Σ_{i∈C} 1/m_i and m_i = odds_i*(1-tax) + tax — so profit is
 * T/S - T and the only thing a sacrifice changes is dropping 1/m_k out of S.
 * Dropping the largest 1/m_k (the shortest-priced scenario, i.e. the
 * bookmaker's favourite) therefore buys the most profit, which is why the
 * best plan is so often the one you least want to give up.
 *
 * The Inc. checkboxes are deliberately ignored: picking a sacrifice is what
 * sets them. Rows priced at or below 1 can never be staked, so they are not
 * offered — giving one up costs nothing because it was already uncovered.
 */
export const coverPlans = (
  rows: Row[],
  tax: string | number,
  targetStake: string | number,
): CoverPlan[] => {
  const T = toNumber(targetStake);
  const taxRate = toNumber(tax);
  if (!(T > 0)) return [];

  const inv = new Map<number, number>();
  rows.forEach((row, i) => {
    const m = toNumber(row.odds) * (1 - taxRate) + taxRate;
    if (toNumber(row.odds) > 1 && m > 0) inv.set(i, 1 / m);
  });
  const pool = [...inv.keys()];
  if (pool.length === 0) return [];

  const sumAll = pool.reduce((a, i) => a + (inv.get(i) as number), 0);
  const plan = (sacrifice: number | null, S: number): CoverPlan => {
    const profit = T / S - T;
    return {
      sacrifice,
      coveredCount: pool.length - (sacrifice === null ? 0 : 1),
      profit,
      profitPct: (profit / T) * 100,
    };
  };

  const plans = [plan(null, sumAll)];
  // Giving up the only stakeable scenario would leave nothing to stake at all.
  if (pool.length > 1) {
    for (const i of pool) plans.push(plan(i, sumAll - (inv.get(i) as number)));
  }
  return plans;
};

/**
 * Rows restaked to the given plan: `sacrifice` is excluded and left on zero,
 * every other stakeable scenario shares the budget for equal profit. Returns
 * null when there is nothing to stake.
 */
export const applyCoverPlan = (
  rows: Row[],
  tax: string | number,
  targetStake: string | number,
  sacrifice: number | null,
): Row[] | null => {
  const marked = rows.map((row, i) => ({
    ...row,
    excluded: sacrifice !== null && i === sacrifice,
  }));
  const stakes = balanceProfitStakes(marked, tax, targetStake);
  if (!stakes) return null;
  return marked.map((row, i) => ({ ...row, stake: String(stakes[i]) }));
};

export type BalanceWinResult =
  { ok: true; stakes: number[]; total: number; remaining: number } | { ok: false; message: string };

/**
 * Set every included scenario's gross return to `targetWin`:
 * stake_i = win / odds_i, rounded UP so each total win stays at or above
 * target. Refuses when the budget can't cover it.
 */
export const balanceWinStakes = (
  rows: Row[],
  targetStake: string | number,
  targetWin: string | number,
): BalanceWinResult => {
  const T = toNumber(targetStake);
  const W = toNumber(targetWin);
  if (!(W > 0)) {
    return { ok: false, message: "Enter a Total win amount greater than 0." };
  }

  const validIdx = stakeableIdx(rows);
  if (validIdx.length === 0) {
    return {
      ok: false,
      message: "No scenarios are eligible — check the odds and include at least one row.",
    };
  }

  const sumInvOdds = validIdx.reduce((a, i) => a + 1 / toNumber(rows[i].odds), 0);
  const needed = W * sumInvOdds;
  if (T > 0 && needed > T + 1e-9) {
    return {
      ok: false,
      message: `Can't balance: a ${fmt(W)} Total win needs ${fmt(needed)} total stake — max win for this budget is ${fmt(T / sumInvOdds)}.`,
    };
  }

  const factor = 100;
  const stakes = rows.map(() => 0);
  validIdx.forEach((i) => {
    stakes[i] = Math.ceil((W / toNumber(rows[i].odds)) * factor) / factor;
  });
  const total = stakes.reduce((a, b) => a + b, 0);
  return { ok: true, stakes, total, remaining: T - total };
};

/** "AW + BL" -> "Arsenal + Chelsea" (names line). */
export const scenarioTeams = (scenario: string, teamNames: string[]): string =>
  scenario
    .split(" + ")
    .map((tok) => {
      const idx = TEAM_LETTERS.indexOf(tok[0]);
      return teamNames[idx]?.trim() || tok[0];
    })
    .join(" + ");

/** "AW + BL" -> "W · L" (outcomes line). */
export const scenarioOutcomes = (scenario: string): string =>
  scenario
    .split(" + ")
    .map((tok) => tok.slice(1))
    .join(" · ");

/** "AW + BL" -> "Arsenal W + Chelsea L" (single line, for PDF and selects). */
export const labelScenario = (scenario: string, teamNames: string[]): string =>
  scenario
    .split(" + ")
    .map((tok) => {
      const letter = tok[0];
      const outcome = tok.slice(1);
      const idx = TEAM_LETTERS.indexOf(letter);
      const nm = teamNames[idx]?.trim();
      return `${nm || letter} ${outcome}`;
    })
    .join(" + ");
