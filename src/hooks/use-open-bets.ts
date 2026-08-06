import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { OpenBet } from "@/lib/exposure";

/**
 * Saved bets that have not been settled yet — the only ones still carrying
 * live exposure, so the only ones a new bet can correlate with.
 *
 * Returns an empty list until the query lands, and again if it fails: the
 * correlation guard is an extra warning, never a gate, so a dropped connection
 * must not block staking. `refresh` re-reads after a save adds a new bet.
 */
export function useOpenBets(enabled = true): { openBets: OpenBet[]; refresh: () => void } {
  const [openBets, setOpenBets] = useState<OpenBet[]>([]);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    void (async () => {
      const { data, error } = await supabase
        .from("bets")
        .select("id,title,team_count,team_names,games,rows")
        .is("won_scenario", null);
      if (live && !error) setOpenBets((data ?? []) as OpenBet[]);
    })();
    return () => {
      live = false;
    };
  }, [enabled, tick]);

  const refresh = useCallback(() => setTick((t) => t + 1), []);
  return { openBets, refresh };
}
