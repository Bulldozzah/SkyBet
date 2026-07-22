import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error("Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in .env");
}

// This app is server-rendered, so this module is evaluated on the server too,
// where there is no localStorage and no session. Session persistence is
// therefore browser-only: on the server the client stays anonymous and every
// auth-dependent screen renders its loading state until the browser takes over.
const isBrowser = typeof window !== "undefined";

export const supabase = createClient(supabaseUrl ?? "", supabaseAnonKey ?? "", {
  auth: {
    persistSession: isBrowser,
    autoRefreshToken: isBrowser,
    detectSessionInUrl: isBrowser,
  },
});

export type ProfileStatus = "pending" | "approved" | "rejected";
export type ProfileRole = "user" | "admin";

export interface Profile {
  id: string;
  email: string | null;
  full_name: string | null;
  role: ProfileRole;
  status: ProfileStatus;
  payment_proof_url: string | null;
  created_at: string;
}

// Scenario row as stored on a saved bet. `name` is the canonical "AW + BL"
// form — the ordering contract every screen indexes off.
export interface BetRow {
  name: string;
  stake: string;
  odds: string;
  excluded?: boolean;
}

export interface OutcomeOdds {
  W: string;
  D: string;
  L: string;
}

export interface BetGame {
  home: string;
  away: string;
  league?: string;
}

/**
 * Everything the Calculator needs to restore a bet. Both a saved row from the
 * database and a fresh pick handed over by the Scanner satisfy this.
 */
export interface LoadableBet {
  title: string;
  team_count: number;
  tax: number;
  target_stake: number;
  rows: BetRow[];
  team_names: string[];
  outcome_odds?: OutcomeOdds[] | null;
  games?: BetGame[] | null;
}

/** A bet as persisted in the `bets` table. */
export interface Bet extends LoadableBet {
  id: string;
  user_id: string;
  won_scenario: string | null;
  settled_at: string | null;
  created_at: string;
}
