// Cross-bet correlation warning, shared by the Calculator and the combo
// preview so every screen names an overlap the same way.

import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { fmt } from "@/lib/calculator";
import type { OpenBetClash } from "@/lib/exposure";

/** What each clashing bet shares, as one readable phrase. */
const sharedText = (clash: OpenBetClash): string =>
  clash.clashes
    .map((c) => (c.sameFixture ? `the fixture ${c.event}` : c.names.join(", ")))
    .join("; ");

/**
 * `combinedStake`, when given, is this bet's stake plus everything already
 * riding on the clashing bets — the number that matters, since a shared
 * fixture can take all of it down together.
 */
export function ExposureWarning({
  clashes,
  combinedStake,
  compact = false,
}: {
  clashes: OpenBetClash[];
  combinedStake?: number;
  compact?: boolean;
}) {
  if (clashes.length === 0) return null;

  return (
    <div
      role="alert"
      className={cn(
        "flex gap-3 rounded-lg border border-destructive/50 bg-destructive/10 text-destructive",
        compact ? "px-3 py-2 text-xs" : "px-4 py-3 text-sm",
      )}
    >
      <AlertTriangle className={cn("mt-0.5 shrink-0", compact ? "h-3.5 w-3.5" : "h-4 w-4")} />
      <div className="min-w-0">
        <p className="font-semibold">
          You already have money on{" "}
          {clashes.length === 1 ? "an unsettled bet" : `${clashes.length} unsettled bets`} covering
          this
        </p>
        <ul className="mt-1 space-y-0.5">
          {clashes.map((c) => (
            <li key={c.betId}>
              <span className="font-medium">{c.betTitle}</span> — {fmt(c.stake)} staked, shares{" "}
              {sharedText(c)}
            </li>
          ))}
        </ul>
        <p className={cn("mt-1.5", compact ? "text-[11px] leading-snug" : "text-xs")}>
          One upset in a shared fixture can take out the excluded scenario on both bets at once, so
          this does not spread the risk — it stacks on the same result.
          {combinedStake !== undefined && ` Combined exposure ${fmt(combinedStake)}.`}
        </p>
      </div>
    </div>
  );
}
