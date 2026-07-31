// Prediction-market (exchange) support — Kalshi and Polymarket.
//
// Both venues arrive through The Odds API's `us_ex` region as ordinary
// bookmakers with decimal odds, so the scanner and value maths apply untouched.
// What differs is the *placement* model, and this module owns that difference:
//
//   - Exchanges price in cents. A contract costing p¢ pays $1 if it settles
//     YES, so decimal odds are 100/p and a stake at odds o buys stake*o
//     contracts. Thinking in contracts is what makes an exchange slip readable.
//   - Single legs are standing order-book prices — placeable as quoted (top of
//     book, so only for limited size). Multi-leg combos are RFQ-quoted: the
//     venue quotes a price for the bundle when asked, valid for seconds. The
//     product of leg prices is therefore an ESTIMATE, and the useful number is
//     the max price at which a quote still clears the target margin.
//   - Kalshi charges a trading fee (~0.07 * price * (1-price) per contract,
//     rounded up to the cent). Polymarket currently charges none. The fee is
//     paid on the trade, not on winnings, so the Calculator's tax field cannot
//     model it — it must be priced into the odds instead.

import type { Game } from "./odds-api";
import type { BetRow } from "./supabase";
import { toNumber } from "./bet-stats";

export const EXCHANGES = [
  { key: "kalshi", title: "Kalshi" },
  { key: "polymarket", title: "Polymarket" },
] as const;

/** `bookmakers=` selector for the odds proxy — 2 keys, so 1 credit per league. */
export const EXCHANGE_BOOKMAKERS = EXCHANGES.map((e) => e.key).join(",");

/** Region fallback for the proxy call; ignored whenever bookmakers are named. */
export const EXCHANGE_REGION = "us_ex";

/** Decimal odds -> contract price in cents (what one $1 contract costs). */
export const toCents = (odds: number): number => 100 / odds;

/** "47.2¢" — quote-shaped display of a contract or scenario price. */
export const fmtCents = (cents: number): string => `${cents.toFixed(1)}¢`;

const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * Kalshi's trading fee in dollars: 0.07 * contracts * P * (1-P), P in dollars,
 * rounded up to the next cent. Steepest near 50¢, negligible at the extremes.
 * An estimate — the published schedule varies by market type.
 */
export const kalshiFeeUsd = (contracts: number, priceCents: number): number => {
  const p = priceCents / 100;
  return Math.ceil(7 * contracts * p * (1 - p)) / 100;
};

/**
 * Effective decimal odds at Kalshi once the fee rides on the price: a contract
 * at p really costs p + 0.07*p*(1-p), so the true odds are slightly shorter.
 */
export const kalshiFeeAdjustedOdds = (odds: number): number => {
  const p = 1 / odds;
  return 1 / (p + 0.07 * p * (1 - p));
};

/**
 * Copy of the games with every Kalshi book's odds fee-adjusted, so a thin
 * "arb" against Kalshi that dies to fees never survives the scan. Other books
 * (Polymarket) pass through untouched.
 */
export const applyKalshiFees = (games: Game[]): Game[] =>
  games.map((g) => ({
    ...g,
    books: g.books.map((bk) =>
      bk.key === "kalshi"
        ? {
            ...bk,
            W: round2(kalshiFeeAdjustedOdds(bk.W)),
            D: round2(kalshiFeeAdjustedOdds(bk.D)),
            L: round2(kalshiFeeAdjustedOdds(bk.L)),
          }
        : bk,
    ),
  }));

/* ------------------------------------------------------------ contract slip */

export interface SlipLine {
  name: string;
  odds: number;
  /** 100/odds — for RFQ legs, the max quote that keeps this margin. */
  priceCents: number;
  /** $1-payout contracts bought: stake * odds. */
  contracts: number;
  /** The stake, i.e. contracts * price. */
  cost: number;
  /** Kalshi fee estimate for this line (0 when fees are off). */
  fee: number;
}

export interface Slip {
  lines: SlipLine[];
  cost: number;
  fees: number;
  /** cost + fees — what leaves the account on placement. */
  outlay: number;
  /** Profit of the worst and best COVERED scenario, net of the whole outlay. */
  worst: number;
  best: number;
  /** Scenarios carrying no stake (the uncovered exclusion); null when none. */
  uncoveredLoss: number | null;
}

/**
 * A staking plan re-read as an exchange order slip. Any rows the Calculator
 * could produce work here — excluded rows simply carry no stake and surface as
 * the uncovered loss.
 */
export const buildSlip = (rows: BetRow[], withKalshiFees: boolean): Slip => {
  const lines: SlipLine[] = rows
    .filter((r) => toNumber(r.stake) > 0)
    .map((r) => {
      const odds = toNumber(r.odds);
      const cost = toNumber(r.stake);
      const contracts = cost * odds;
      const priceCents = toCents(odds);
      return {
        name: r.name,
        odds,
        priceCents,
        contracts,
        cost,
        fee: withKalshiFees ? kalshiFeeUsd(contracts, priceCents) : 0,
      };
    });

  const cost = lines.reduce((a, l) => a + l.cost, 0);
  const fees = lines.reduce((a, l) => a + l.fee, 0);
  const outlay = cost + fees;
  const profits = lines.map((l) => l.contracts - outlay);

  return {
    lines,
    cost,
    fees,
    outlay,
    worst: profits.length ? Math.min(...profits) : 0,
    best: profits.length ? Math.max(...profits) : 0,
    uncoveredLoss: lines.length < rows.length ? -outlay : null,
  };
};

/* -------------------------------------------------------------- demo odds */

const hoursFromNow = (h: number): string => new Date(Date.now() + h * 3600 * 1000).toISOString();

/** Book from cent prices, the way an exchange actually displays them. */
const venue = (key: string, title: string, w: number, d: number, l: number) => ({
  key,
  title,
  W: round2(100 / w),
  D: round2(100 / d),
  L: round2(100 / l),
});

/**
 * Sample exchange fixtures so the page works without credits or `us_ex`
 * coverage. Same shape as normalizeEvents() output; kickoffs are generated at
 * call time so SSR and the client agree (see demo-odds.ts for why). The
 * Sunderland fixture is engineered to hold a genuine cross-venue arb: best
 * prices sum to 96¢, wide enough that it survives the Kalshi fee adjustment.
 */
export const getPolyDemoGames = (): Game[] => [
  {
    id: "poly-demo-1",
    home: "Arsenal",
    away: "Chelsea",
    commence: hoursFromNow(24),
    league: "Demo Exchange",
    books: [venue("kalshi", "Kalshi", 46, 29, 28), venue("polymarket", "Polymarket", 47, 27, 28)],
  },
  {
    id: "poly-demo-2",
    home: "Sunderland",
    away: "Everton",
    commence: hoursFromNow(27),
    league: "Demo Exchange",
    books: [venue("kalshi", "Kalshi", 45, 28, 27), venue("polymarket", "Polymarket", 47, 26, 25)],
  },
  {
    id: "poly-demo-3",
    home: "Man City",
    away: "Fulham",
    commence: hoursFromNow(30),
    league: "Demo Exchange",
    books: [venue("kalshi", "Kalshi", 72, 18, 14), venue("polymarket", "Polymarket", 71, 17, 15)],
  },
  {
    id: "poly-demo-4",
    home: "Newcastle",
    away: "Aston Villa",
    commence: hoursFromNow(48),
    league: "Demo Exchange",
    books: [venue("kalshi", "Kalshi", 38, 30, 34), venue("polymarket", "Polymarket", 39, 29, 35)],
  },
  {
    id: "poly-demo-5",
    home: "Liverpool",
    away: "Brighton",
    commence: hoursFromNow(51),
    league: "Demo Exchange",
    books: [venue("kalshi", "Kalshi", 55, 25, 23), venue("polymarket", "Polymarket", 54, 26, 22)],
  },
];
