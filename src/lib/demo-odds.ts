// Bundled sample odds so the Scanner can be tried without an API key.
// Shaped exactly like normalizeEvents() output. Kickoffs are generated
// relative to "now" so the demo never looks stale. One game (Leipzig v
// Frankfurt) is engineered to contain a genuine cross-book 3-way arb.

import type { BookOdds, Game } from "./odds-api";

const hoursFromNow = (h: number): string => new Date(Date.now() + h * 3600 * 1000).toISOString();

const book = (key: string, title: string, W: number, D: number, L: number): BookOdds => ({
  key,
  title,
  W,
  D,
  L,
});

export const DEMO_GAMES: Game[] = [
  {
    id: "demo-1",
    home: "Arsenal",
    away: "Chelsea",
    commence: hoursFromNow(26),
    league: "Demo League",
    books: [
      book("betway", "Betway", 2.1, 3.5, 3.4),
      book("onexbet", "1xBet", 2.15, 3.4, 3.3),
      book("bet365", "Bet365", 2.05, 3.7, 3.45),
    ],
  },
  {
    id: "demo-2",
    home: "Real Madrid",
    away: "Villarreal",
    commence: hoursFromNow(28),
    league: "Demo League",
    books: [
      book("betway", "Betway", 1.36, 5.0, 8.0),
      book("onexbet", "1xBet", 1.38, 4.8, 7.5),
      book("bet365", "Bet365", 1.33, 5.25, 8.5),
    ],
  },
  {
    id: "demo-3",
    home: "RB Leipzig",
    away: "Eintracht Frankfurt",
    commence: hoursFromNow(30),
    league: "Demo League",
    books: [
      book("betway", "Betway", 2.6, 3.55, 2.7),
      book("onexbet", "1xBet", 2.75, 3.4, 2.6),
      book("bet365", "Bet365", 2.55, 3.75, 2.85),
    ],
  },
  {
    id: "demo-4",
    home: "PSG",
    away: "Marseille",
    commence: hoursFromNow(46),
    league: "Demo League",
    books: [
      book("betway", "Betway", 1.55, 4.2, 5.6),
      book("onexbet", "1xBet", 1.57, 4.1, 5.4),
      book("bet365", "Bet365", 1.53, 4.33, 6.0),
    ],
  },
  {
    id: "demo-5",
    home: "Inter Milan",
    away: "Juventus",
    commence: hoursFromNow(50),
    league: "Demo League",
    books: [
      book("betway", "Betway", 2.25, 3.2, 3.3),
      book("onexbet", "1xBet", 2.3, 3.1, 3.25),
      book("bet365", "Bet365", 2.2, 3.3, 3.4),
    ],
  },
  {
    id: "demo-6",
    home: "Ajax",
    away: "PSV",
    commence: hoursFromNow(52),
    league: "Demo League",
    books: [
      book("betway", "Betway", 2.9, 3.6, 2.35),
      book("onexbet", "1xBet", 3.0, 3.5, 2.3),
      book("bet365", "Bet365", 2.85, 3.7, 2.4),
    ],
  },
];
