// The Poly desk's own calculator: a staking plan re-read as an exchange order
// slip — cents and contracts instead of stakes and odds. For multi-leg
// scenarios the "Max price" column is the whole point: combos are RFQ-quoted
// at the venue, so the placeable number is not the estimate shown but the
// quote you accept, and this column says how high that quote may go before
// the margin is gone.

import { useMemo, useState } from "react";
import { X, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ScannerBet } from "@/lib/scanner";
import { buildSlip, fmtCents } from "@/lib/poly";
import { labelScenario } from "@/lib/calculator";
import { fmt, toNumber } from "@/lib/bet-stats";

export function ContractSlipModal({
  build,
  bookLabel,
  onClose,
  onLoad,
}: {
  /** Rebuilds the bet at a given budget, so the slip re-prices as you type. */
  build: (budget: number) => ScannerBet;
  bookLabel: string;
  onClose: () => void;
  onLoad: (bet: ScannerBet) => void;
}) {
  const [budget, setBudget] = useState("100");
  // Off by default: fees may already be priced into the scanned odds via the
  // page's "price in Kalshi fees" toggle, and stacking both would double-count.
  const [fees, setFees] = useState(false);

  const bet = useMemo(() => {
    const b = toNumber(budget);
    return build(b > 0 ? b : 100);
  }, [build, budget]);

  const slip = useMemo(() => buildSlip(bet.rows, fees), [bet, fees]);
  const multiLeg = bet.team_count > 1;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-border bg-card p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">Contract slip</h2>
            <p className="text-xs text-muted-foreground">via {bookLabel}</p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close contract slip"
            className="btn-ghost h-8 w-8 shrink-0 justify-center p-0"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {(bet.games ?? []).map((g, i) => (
          <div key={i} className="truncate text-sm font-semibold">
            {g.home} <span className="text-muted-foreground">v</span> {g.away}
          </div>
        ))}

        <div className="mt-3 flex flex-wrap items-end gap-4">
          <div className="w-28">
            <label className="label" htmlFor="slip-budget">
              Budget
            </label>
            <input
              id="slip-budget"
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
              inputMode="decimal"
              className="input"
            />
          </div>
          <label className="flex items-center gap-2 pb-2 text-xs font-semibold">
            <input type="checkbox" checked={fees} onChange={(e) => setFees(e.target.checked)} />
            Estimate Kalshi trading fees
          </label>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Fees apply only to legs placed on Kalshi; leave this off if the scan already priced them
          in. Polymarket currently charges no trading fee.
        </p>

        <div className="mt-3 overflow-x-auto rounded-md border border-border">
          <table className="w-full text-xs">
            <thead className="bg-secondary uppercase tracking-wide text-secondary-foreground">
              <tr>
                <th className="p-2 text-left">Scenario</th>
                <th className="p-2 text-right" title="Accept quotes at or below this price">
                  Max price
                </th>
                <th className="p-2 text-right">Contracts</th>
                <th className="p-2 text-right">Cost</th>
                {fees && <th className="p-2 text-right">Fee</th>}
                <th className="p-2 text-right">Profit if it hits</th>
              </tr>
            </thead>
            <tbody>
              {slip.lines.map((l) => {
                const profit = l.contracts - slip.outlay;
                return (
                  <tr key={l.name} className="border-t border-border">
                    <td className="p-2 font-medium">{labelScenario(l.name, bet.team_names)}</td>
                    <td className="p-2 text-right font-mono font-semibold">
                      {fmtCents(l.priceCents)}
                    </td>
                    <td className="p-2 text-right font-mono">{l.contracts.toFixed(1)}</td>
                    <td className="p-2 text-right font-mono">{fmt(l.cost)}</td>
                    {fees && <td className="p-2 text-right font-mono">{fmt(l.fee)}</td>}
                    <td
                      className={cn(
                        "p-2 text-right font-mono",
                        profit >= 0 ? "text-success" : "text-destructive",
                      )}
                    >
                      {fmt(profit)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t border-border bg-secondary/40 font-semibold">
                <td className="p-2">Total outlay</td>
                <td className="p-2" />
                <td className="p-2" />
                <td className="p-2 text-right font-mono">{fmt(slip.cost)}</td>
                {fees && <td className="p-2 text-right font-mono">{fmt(slip.fees)}</td>}
                <td className="p-2 text-right font-mono">{fmt(slip.outlay)}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
          <div className="rounded-lg border border-border bg-secondary/40 px-3 py-2">
            <div className="label mb-0.5">Worst covered</div>
            <div
              className={cn(
                "text-lg font-extrabold leading-tight",
                slip.worst >= 0 ? "text-success" : "text-destructive",
              )}
            >
              {fmt(slip.worst)}
            </div>
          </div>
          <div className="rounded-lg border border-border bg-secondary/40 px-3 py-2">
            <div className="label mb-0.5">Best covered</div>
            <div className="text-lg font-extrabold leading-tight text-success">
              {fmt(slip.best)}
            </div>
          </div>
          <div className="rounded-lg border border-border bg-secondary/40 px-3 py-2">
            <div className="label mb-0.5">If uncovered hits</div>
            <div
              className={cn(
                "text-lg font-extrabold leading-tight",
                slip.uncoveredLoss == null ? "text-success" : "text-destructive",
              )}
            >
              {slip.uncoveredLoss == null ? "covered" : fmt(slip.uncoveredLoss)}
            </div>
          </div>
        </div>

        <p className="mt-3 text-xs text-muted-foreground">
          {multiLeg
            ? "Multi-leg scenarios are combo (parlay) contracts quoted by RFQ at the venue. Prices here are products of top-of-book legs — an estimate. Request the quote, and accept only at or below the Max price shown; above it, the margin is gone."
            : "Single-game lines are standing order-book contracts, placeable at these prices for top-of-book size. Deep stakes will walk the book and get worse prices."}
        </p>

        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="btn-secondary py-1.5 text-xs">
            Close
          </button>
          <button onClick={() => onLoad(bet)} className="btn-primary py-1.5 text-xs">
            Load into Calculator <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
