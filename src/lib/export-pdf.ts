import jsPDF from "jspdf";
import { autoTable } from "jspdf-autotable";
import {
  fmt,
  labelScenario,
  sideWord,
  toNumber,
  TEAM_LETTERS,
  type OutcomeOddsInput,
  type Row,
  type RowResult,
  type Sport,
} from "./calculator";

export interface ExportArgs {
  sport: Sport;
  activeTeams: number;
  rows: Row[];
  results: RowResult[];
  teamNames: string[];
  /** Per-participant W/D/L prices, in team order. Blank on the 1-event tab. */
  outcomeOdds?: OutcomeOddsInput[];
  tax: string;
  targetStake: string;
  totalStake: number;
  betTitle: string;
}

/** Landscape scenario table, mirroring betmaster's export layout. */
export function exportBetPDF({
  sport,
  activeTeams,
  rows,
  results,
  teamNames,
  outcomeOdds,
  tax,
  targetStake,
  totalStake,
  betTitle,
}: ExportArgs) {
  const doc = new jsPDF({ orientation: "landscape" });
  const taxRate = toNumber(tax);
  const date = new Date().toLocaleString();

  const betName =
    betTitle.trim() ||
    `${sport.label} · ${activeTeams} ${sideWord(sport, activeTeams).toLowerCase()} · ${date}`;

  doc.setFontSize(16);
  doc.setFont("helvetica", "bold");
  doc.text("BetMaster Calculator", 14, 14);

  doc.setFontSize(11);
  doc.setFont("helvetica", "bold");
  doc.text(betName, 14, 21);

  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(100);
  doc.text(
    `${sport.label}  ·  ${activeTeams} ${sideWord(sport, activeTeams)}  ·  ${rows.length} scenarios  ·  Tax rate: ${taxRate}  ·  Stake: ${fmt(toNumber(targetStake))}  ·  Total stake: ${fmt(totalStake)}  ·  Remaining: ${fmt(toNumber(targetStake) - totalStake)}  ·  Exported: ${date}`,
    14,
    27,
  );

  // Teams & odds — each participant with its W/D/L prices, e.g.
  // "A = AC Milan     W 1.50   D 4.60   L 6.00". On the 1-event tab the three
  // W/D/L prices live in the scenario rows themselves (AW/AD/AL order).
  const perTeamOdds = (i: number): { W: number; D: number; L: number } => {
    if (activeTeams === 1) {
      return {
        W: toNumber(rows[0]?.odds),
        D: toNumber(rows[1]?.odds),
        L: toNumber(rows[2]?.odds),
      };
    }
    const o = outcomeOdds?.[i];
    return { W: toNumber(o?.W), D: toNumber(o?.D), L: toNumber(o?.L) };
  };

  let tableStart = 31;
  doc.setFont("helvetica", "bold");
  doc.text(`${sideWord(sport, 2)} & odds:`, 14, 32);
  doc.setFont("helvetica", "normal");
  let ty = 37;
  for (let i = 0; i < activeTeams; i++) {
    const nm = teamNames[i]?.trim() || TEAM_LETTERS[i];
    const o = perTeamOdds(i);
    const line =
      o.W || o.D || o.L
        ? `${TEAM_LETTERS[i]} = ${nm}      W ${fmt(o.W)}    D ${fmt(o.D)}    L ${fmt(o.L)}`
        : `${TEAM_LETTERS[i]} = ${nm}`;
    doc.text(line, 18, ty);
    ty += 5;
  }
  tableStart = ty + 1;
  doc.setTextColor(0);

  const head = [
    [
      "Scenario",
      "Stake",
      "Odds",
      "Total win",
      "Net payout",
      "Profit",
      "Profit %",
      "Status",
      "Min to cover",
    ],
  ];

  const body = rows.map((row, i) => {
    const r = results[i];
    return [
      labelScenario(row.name, teamNames),
      fmt(toNumber(row.stake)),
      fmt(toNumber(row.odds)),
      fmt(r.gross),
      fmt(r.netPayout),
      fmt(r.profit),
      r.gross > 0 ? `${r.profitPct.toFixed(1)}%` : "—",
      r.covered ? "Covered" : "Loss",
      r.covered ? "—" : r.minToCover === null ? "n/a" : `+${fmt(r.minToCover)}`,
    ];
  });

  autoTable(doc, {
    head,
    body,
    startY: tableStart,
    styles: { fontSize: 8, cellPadding: 3 },
    headStyles: { fillColor: [16, 30, 24], textColor: 255, fontStyle: "bold" },
    alternateRowStyles: { fillColor: [242, 246, 243] },
    didParseCell: (data) => {
      if (data.section !== "body") return;
      const colIndex = data.column.index;
      const r = results[data.row.index];
      if (!r) return;
      if (colIndex === 5 || colIndex === 6) {
        data.cell.styles.textColor = r.profit >= 0 ? [22, 163, 74] : [220, 38, 38];
      }
      if (colIndex === 7) {
        data.cell.styles.fillColor = r.covered ? [220, 252, 231] : [254, 226, 226];
        data.cell.styles.textColor = r.covered ? [22, 163, 74] : [220, 38, 38];
        data.cell.styles.fontStyle = "bold";
      }
    },
  });

  doc.save(`betmaster-${sport.id}-${activeTeams}teams-${Date.now()}.pdf`);
}
