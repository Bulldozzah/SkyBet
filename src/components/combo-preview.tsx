// Read-only preview of a scanned combo, shared by the Scanner and the Test
// workbench so both show the same figures in the same shape.

import { useMemo } from "react";
import { X, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { buildComboBet, type ComboResult } from "@/lib/scanner";
import { computeRows, fmt, TEAM_LETTERS, type Row } from "@/lib/calculator";
import { eventExposures, openBetClashes, type OpenBet } from "@/lib/exposure";
import { ExposureWarning } from "@/components/exposure-warning";

/** 3-letter uppercase abbreviation, e.g. "Arsenal" -> "ARS". */
const abbr = (name: string, fallback: string): string =>
  (name?.trim() ? name.trim().slice(0, 3) : fallback).toUpperCase();

const OUTCOME_TONE: Record<string, string> = {
  W: "bg-success/15 text-success",
  D: "bg-secondary text-secondary-foreground",
  L: "bg-destructive/15 text-destructive",
};

/**
 * Compact read-only preview of a scanned combo: each game's W/D/L odds up top,
 * then every scenario with its 3-letter names, total win, profit % and cover
 * status — the same figures the Calculator would show at a 100 budget.
 *
 * `extra` lets a caller add a row of its own figures under the header without
 * this component having to know about them. `openBets` enables the correlation
 * warning — pass the unsettled bets and any fixture already staked is named
 * here, before the combo can be loaded.
 */
export function ComboPreviewModal({
  result,
  onClose,
  onLoad,
  extra,
  openBets,
}: {
  result: ComboResult;
  onClose: () => void;
  onLoad: () => void;
  extra?: React.ReactNode;
  openBets?: OpenBet[];
}) {
  const bet = useMemo(() => buildComboBet(result), [result]);
  const rows = bet.rows as Row[];
  const { totalStake, results } = useMemo(
    () => computeRows(rows, bet.tax, bet.target_stake),
    [rows, bet.tax, bet.target_stake],
  );
  const names = bet.team_names ?? [];
  const tag = (letter: string) => abbr(names[TEAM_LETTERS.indexOf(letter)] ?? "", letter);

  const clashes = useMemo(
    () =>
      openBets?.length
        ? openBetClashes(eventExposures(result.games, null, result.games.length), openBets)
        : [],
    [openBets, result.games],
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-border bg-card p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">Scenario preview</h2>
            <p className="text-xs text-muted-foreground">
              At a {fmt(totalStake)} budget · via {result.bookLabel}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close preview"
            className="btn-ghost h-8 w-8 shrink-0 justify-center p-0"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {extra}

        {clashes.length > 0 && (
          <div className="mb-3">
            <ExposureWarning clashes={clashes} compact />
          </div>
        )}

        {/* Teams & odds */}
        <div className="mb-3 space-y-1.5">
          {result.games.map((g, i) => {
            const o = result.gamesOdds[i];
            return (
              <div
                key={g.id}
                className="flex items-center justify-between gap-2 rounded-md bg-secondary px-2.5 py-1.5 text-xs"
              >
                <span className="min-w-0 flex-1 truncate font-medium">
                  <span className="mr-1 font-mono font-bold text-primary">
                    {abbr(g.home, TEAM_LETTERS[i])}
                  </span>
                  {g.home} <span className="text-muted-foreground">v</span> {g.away}
                </span>
                <span className="shrink-0 font-mono text-muted-foreground">
                  W {fmt(o.W)} · D {fmt(o.D)} · L {fmt(o.L)}
                </span>
              </div>
            );
          })}
        </div>

        {/* Scenario grid */}
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-xs">
            <thead className="bg-secondary uppercase tracking-wide text-secondary-foreground">
              <tr>
                <th className="p-2 text-left">Scenario</th>
                <th className="p-2 text-right">Total win</th>
                <th className="p-2 text-right">Profit %</th>
                <th className="p-2 text-center">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => {
                const r = results[i];
                return (
                  <tr
                    key={row.name}
                    className={cn("border-t border-border", row.excluded && "opacity-40")}
                  >
                    <td className="p-2">
                      <div className="flex flex-wrap gap-1">
                        {row.name.split(" + ").map((tok) => (
                          <span
                            key={tok}
                            className={cn(
                              "rounded px-1.5 py-0.5 font-mono font-semibold",
                              OUTCOME_TONE[tok.slice(1)],
                            )}
                          >
                            {tag(tok[0])} {tok.slice(1)}
                          </span>
                        ))}
                        {row.excluded && (
                          <span className="rounded bg-warning/20 px-1.5 py-0.5 font-semibold text-warning-foreground">
                            excluded
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="p-2 text-right font-mono">{fmt(r.gross)}</td>
                    <td
                      className={cn(
                        "p-2 text-right font-mono",
                        r.profit >= 0 ? "text-success" : "text-destructive",
                      )}
                    >
                      {r.gross > 0 ? `${r.profitPct.toFixed(1)}%` : "—"}
                    </td>
                    <td className="p-2 text-center">
                      <span
                        title={r.covered ? "Covered" : "Loss"}
                        className={cn(
                          "text-sm font-bold",
                          r.covered ? "text-success" : "text-destructive",
                        )}
                      >
                        {r.covered ? "▲" : "▼"}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Actions */}
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="btn-secondary py-1.5 text-xs">
            Close
          </button>
          <button onClick={onLoad} className="btn-primary py-1.5 text-xs">
            Load into Calculator <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
