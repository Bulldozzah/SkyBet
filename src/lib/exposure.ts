// Correlation guard for cover bets.
//
// Every scenario grid prices its events as independent: row odds are the
// product of each event's outcome odds. That holds inside one bet only while
// the events really are distinct fixtures, and it says nothing at all about
// two separate bets. Two slips that share a fixture are not independent bets —
// one upset can knock out the excluded scenario on both at once, so their
// combined downside is far worse than either slip's own numbers suggest.
//
// This module finds both kinds of overlap so they can be shown before staking.

import type { Bet, BetGame } from "@/lib/supabase";
import { toNumber } from "@/lib/calculator";

/**
 * Case-, accent- and spacing-insensitive, so the same club still matches when
 * a feed spells it "América" one day and "America" the next.
 */
export const normalizeName = (name: string): string =>
  name
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

/** Sides sorted, so the same match matches with home and away swapped. */
const fixtureKey = (home: string, away: string): string =>
  [normalizeName(home), normalizeName(away)].sort().join(" v ");

export interface EventExposure {
  /** Fixture identity, or null when only a participant name is known. */
  fixture: string | null;
  /** Normalized name -> spelling to display. Both sides plus the tracked one. */
  names: Map<string, string>;
  /** Human label for the warning text. */
  label: string;
}

/**
 * What one bet puts at risk, one entry per event. `games` is absent on
 * hand-typed bets, where only the tracked team name is known — those still
 * match by name, just not by fixture.
 */
export const eventExposures = (
  games: BetGame[] | null | undefined,
  teamNames: string[] | null | undefined,
  count: number,
): EventExposure[] => {
  const out: EventExposure[] = [];
  for (let i = 0; i < count; i++) {
    const game = games?.[i];
    const tracked = teamNames?.[i]?.trim() ?? "";
    const home = game?.home?.trim() ?? "";
    const away = game?.away?.trim() ?? "";

    const names = new Map<string, string>();
    for (const nm of [tracked, home, away]) {
      const key = normalizeName(nm);
      if (key) names.set(key, nm);
    }

    const paired = home !== "" && away !== "";
    out.push({
      fixture: paired ? fixtureKey(home, away) : null,
      names,
      label: paired ? `${home} v ${away}` : tracked || `Event ${i + 1}`,
    });
  }
  return out;
};

/** One event overlapping another, either inside a bet or across two bets. */
export interface Clash {
  /** Label of the event in the bet on screen. */
  event: string;
  /** Label of the event it collides with. */
  against: string;
  /** Shared participants, in the spelling they were entered with. */
  names: string[];
  /** True when both are the same fixture, not merely a shared participant. */
  sameFixture: boolean;
}

const clashBetween = (a: EventExposure, b: EventExposure): Clash | null => {
  const names: string[] = [];
  for (const [key, display] of a.names) if (b.names.has(key)) names.push(display);
  if (names.length === 0) return null;
  return {
    event: a.label,
    against: b.label,
    names,
    sameFixture: a.fixture !== null && a.fixture === b.fixture,
  };
};

/**
 * Events of a single bet that share a participant. This is a correctness
 * problem rather than a risk one: the grid multiplies the odds as if the two
 * events were independent, so it prices rows for combinations that cannot
 * both happen.
 */
export const selfClashes = (events: EventExposure[]): Clash[] => {
  const out: Clash[] = [];
  for (let i = 0; i < events.length; i++) {
    for (let j = i + 1; j < events.length; j++) {
      const clash = clashBetween(events[i], events[j]);
      if (clash) out.push(clash);
    }
  }
  return out;
};

/** A saved, unsettled bet reduced to the fields the guard needs. */
export type OpenBet = Pick<Bet, "id" | "title" | "team_count" | "team_names" | "games" | "rows">;

export interface OpenBetClash {
  betId: string;
  betTitle: string;
  /** Total actually staked there, summed from its scenario rows. */
  stake: number;
  clashes: Clash[];
}

/**
 * Overlaps between the bet on screen and bets already placed and unsettled.
 * Settled bets are excluded by the caller — their result is known, so they
 * carry no live exposure to correlate with.
 */
export const openBetClashes = (events: EventExposure[], open: OpenBet[]): OpenBetClash[] => {
  const out: OpenBetClash[] = [];
  for (const bet of open) {
    const theirs = eventExposures(bet.games, bet.team_names, bet.team_count);
    const clashes: Clash[] = [];
    for (const mine of events) {
      for (const other of theirs) {
        const clash = clashBetween(mine, other);
        if (clash) clashes.push(clash);
      }
    }
    if (clashes.length === 0) continue;
    const rows = Array.isArray(bet.rows) ? bet.rows : [];
    out.push({
      betId: bet.id,
      betTitle: bet.title,
      stake: rows.reduce((sum, r) => sum + toNumber(r.stake), 0),
      clashes,
    });
  }
  return out;
};
