// Sample data and calculation helpers for BetMaster UI mock

export type Outcome = "W" | "D" | "L";
export const OUTCOMES: Outcome[] = ["W", "D", "L"];

export function scenarioIndices(n: number): Outcome[][] {
  const total = Math.pow(3, n);
  const rows: Outcome[][] = [];
  for (let i = 0; i < total; i++) {
    const row: Outcome[] = [];
    for (let t = 0; t < n; t++) {
      const idx = Math.floor(i / Math.pow(3, n - 1 - t)) % 3;
      row.push(OUTCOMES[idx]);
    }
    rows.push(row);
  }
  return rows;
}

export function fmt(n: number, d = 2) {
  if (!isFinite(n)) return "—";
  return n.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
}

// Sample participants for calculator preview
export const sampleTeams = [
  { name: "Arsenal", W: 2.10, D: 3.40, L: 3.20 },
  { name: "Chelsea", W: 1.95, D: 3.50, L: 3.80 },
];

export interface SampleBet {
  id: string;
  title: string;
  savedAt: string;
  sport: string;
  events: number;
  participants: string[];
  totalStake: number;
  taxRate: number;
  status: "Pending" | "Won" | "Lost";
  winner?: string;
  netProfit?: number;
  returned?: number;
}

export const sampleBets: SampleBet[] = [
  {
    id: "b1",
    title: "Arsenal vs Chelsea — Weekend Cover",
    savedAt: "2026-07-20T18:30:00Z",
    sport: "Football",
    events: 1,
    participants: ["Arsenal"],
    totalStake: 100,
    taxRate: 0.10,
    status: "Won",
    winner: "Arsenal W",
    returned: 189,
    netProfit: 89,
  },
  {
    id: "b2",
    title: "Serie A Double — Inter + Milan",
    savedAt: "2026-07-19T14:15:00Z",
    sport: "Football",
    events: 2,
    participants: ["Inter", "Milan"],
    totalStake: 200,
    taxRate: 0.10,
    status: "Lost",
    winner: undefined,
    returned: 0,
    netProfit: -200,
  },
  {
    id: "b3",
    title: "NBA Triple Cover",
    savedAt: "2026-07-21T20:00:00Z",
    sport: "Basketball",
    events: 3,
    participants: ["Lakers", "Celtics", "Warriors"],
    totalStake: 300,
    taxRate: 0.10,
    status: "Pending",
  },
  {
    id: "b4",
    title: "UFC 315 — Main Card",
    savedAt: "2026-07-18T22:00:00Z",
    sport: "UFC",
    events: 2,
    participants: ["Jones", "Aspinall"],
    totalStake: 150,
    taxRate: 0.05,
    status: "Won",
    winner: "Jones W + Aspinall W",
    returned: 245,
    netProfit: 95,
  },
  {
    id: "b5",
    title: "Wimbledon Quarters",
    savedAt: "2026-07-15T13:00:00Z",
    sport: "Tennis",
    events: 1,
    participants: ["Alcaraz"],
    totalStake: 80,
    taxRate: 0.10,
    status: "Pending",
  },
];

export interface ScannerResult {
  id: string;
  fixtures: { home: string; away: string; league: string; kickoff: string }[];
  bookmaker: string;
  mode: "same" | "best";
  profitPct: number;
  coverage: string; // "9/9" or "8/9"
  excluded?: string;
  excludedProb?: number; // percent
  fullCover: boolean;
}

export const sampleScannerResults: ScannerResult[] = [
  {
    id: "s1",
    fixtures: [
      { home: "Real Madrid", away: "Barcelona", league: "La Liga", kickoff: "Sat 20:00" },
      { home: "Bayern", away: "Dortmund", league: "Bundesliga", kickoff: "Sat 18:30" },
    ],
    bookmaker: "Best odds (Bet365, Pinnacle)",
    mode: "best",
    profitPct: 3.42,
    coverage: "9/9",
    fullCover: true,
  },
  {
    id: "s2",
    fixtures: [
      { home: "Arsenal", away: "Man City", league: "Premier League", kickoff: "Sun 16:30" },
      { home: "Inter", away: "Juventus", league: "Serie A", kickoff: "Sun 20:45" },
    ],
    bookmaker: "Pinnacle",
    mode: "same",
    profitPct: 2.18,
    coverage: "8/9",
    excluded: "Man City W + Juventus D",
    excludedProb: 8.4,
    fullCover: false,
  },
  {
    id: "s3",
    fixtures: [
      { home: "PSG", away: "Marseille", league: "Ligue 1", kickoff: "Sat 21:00" },
      { home: "Liverpool", away: "Chelsea", league: "Premier League", kickoff: "Sun 17:30" },
      { home: "Atletico", away: "Sevilla", league: "La Liga", kickoff: "Sun 21:00" },
    ],
    bookmaker: "Best odds (Bet365, Pinnacle, Betfair)",
    mode: "best",
    profitPct: 5.62,
    coverage: "26/27",
    excluded: "PSG W + Liverpool D + Sevilla W",
    excludedProb: 2.1,
    fullCover: false,
  },
  {
    id: "s4",
    fixtures: [
      { home: "Lakers", away: "Warriors", league: "NBA", kickoff: "Tue 03:00" },
      { home: "Celtics", away: "Heat", league: "NBA", kickoff: "Tue 01:30" },
    ],
    bookmaker: "DraftKings",
    mode: "same",
    profitPct: 1.05,
    coverage: "8/9",
    excluded: "Warriors W + Heat W",
    excludedProb: 18.2,
    fullCover: false,
  },
];

export const sampleFixtureArbs = [
  {
    id: "a1",
    home: "Djokovic",
    away: "Sinner",
    league: "ATP Finals",
    kickoff: "Tomorrow 14:00",
    legs: [
      { outcome: "W", odds: 2.15, bookmaker: "Pinnacle" },
      { outcome: "D", odds: 12.0, bookmaker: "Bet365" },
      { outcome: "L", odds: 2.20, bookmaker: "Betfair" },
    ],
    profitPct: 1.82,
  },
];

// Stats helpers
export function getStats(period: 7 | 30 | 90 | 999) {
  const now = new Date("2026-07-22T00:00:00Z").getTime();
  const cutoff = now - period * 24 * 60 * 60 * 1000;
  const inRange = sampleBets.filter((b) => new Date(b.savedAt).getTime() >= cutoff);
  const settled = inRange.filter((b) => b.status !== "Pending");
  const pending = inRange.filter((b) => b.status === "Pending");
  const totalStaked = inRange.reduce((s, b) => s + b.totalStake, 0);
  const settledStaked = settled.reduce((s, b) => s + b.totalStake, 0);
  const returns = settled.reduce((s, b) => s + (b.returned ?? 0), 0);
  const netProfit = settled.reduce((s, b) => s + (b.netProfit ?? 0), 0);
  const pendingExposure = pending.reduce((s, b) => s + b.totalStake, 0);
  const wins = settled.filter((b) => (b.netProfit ?? 0) > 0).length;
  const losses = settled.length - wins;
  const roi = settledStaked > 0 ? (netProfit / settledStaked) * 100 : 0;
  return {
    total: inRange.length,
    totalStaked,
    returns,
    netProfit,
    roi,
    pendingExposure,
    wins,
    losses,
    pending: pending.length,
    bets: inRange,
  };
}
