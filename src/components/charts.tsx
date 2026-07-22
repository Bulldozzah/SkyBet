import { useRef, useState, type ReactNode } from "react";

// Dependency-free SVG charts, theme-aware via the --chart-* CSS variables.
// Hand-rolled rather than pulling in a chart library because this app is
// server-rendered: these produce identical markup on the server and the
// client, so they can't cause a hydration mismatch.
//
// Colour note: --chart-pos / --chart-neg are a good/bad status pair. Green and
// red are indistinguishable under deuteranopia, so polarity is ALWAYS encoded
// a second way too — bars sit above or below a zero baseline, values carry an
// explicit sign, and the donut adds a legend, counts and a hatch texture.

const W = 1000;
const H = 300;
const PAD_T = 14;
const PAD_B = 40;
const PLOT_H = H - PAD_T - PAD_B;

const fmt2 = (n: number) =>
  n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Signed, so a value's polarity survives without colour. */
const signed = (n: number) => `${n >= 0 ? "+" : ""}${fmt2(n)}`;

export interface Point {
  label: string;
  short?: string;
  value: number;
}

interface Tip {
  x: number;
  y: number;
  label: string;
  value: string;
}

/** Positions a tooltip at the pointer, clamped inside the chart box. */
function useTooltip() {
  const ref = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<Tip | null>(null);

  const show = (e: React.MouseEvent, label: string, value: string) => {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    setTip({
      x: Math.min(e.clientX - box.left + 12, box.width - 140),
      y: Math.max(e.clientY - box.top - 44, 0),
      label,
      value,
    });
  };
  const hide = () => setTip(null);
  return { ref, tip, show, hide };
}

function Tooltip({ tip }: { tip: Tip | null }) {
  if (!tip) return null;
  return (
    <div
      role="status"
      className="pointer-events-none absolute z-10 rounded-md border border-border bg-card px-2 py-1 text-xs shadow-md"
      style={{ left: tip.x, top: tip.y }}
    >
      <span className="block text-muted-foreground">{tip.label}</span>
      <span className="block font-mono font-semibold text-foreground">{tip.value}</span>
    </div>
  );
}

function ChartFrame({
  children,
  wrapRef,
  onLeave,
}: {
  children: ReactNode;
  wrapRef: React.RefObject<HTMLDivElement | null>;
  onLeave: () => void;
}) {
  return (
    <div className="relative w-full" ref={wrapRef} onMouseLeave={onLeave}>
      {children}
    </div>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="py-8 text-center text-sm text-muted-foreground">{children}</p>;
}

function GridLines({ ys }: { ys: number[] }) {
  return (
    <>
      {ys.map((y, i) => (
        <line key={i} x1="0" x2={W} y1={y} y2={y} stroke="var(--chart-grid)" strokeWidth="1" />
      ))}
    </>
  );
}

/**
 * Single-series magnitude bars. `polarity` switches to a zero-baseline layout
 * where bars point up for positive and down for negative — position, not just
 * colour, carries the sign.
 */
export function BarChart({ data, polarity = false }: { data: Point[]; polarity?: boolean }) {
  const { ref, tip, show, hide } = useTooltip();
  if (!data.length) return <Empty>No data for this period.</Empty>;

  const barW = W / data.length;
  const labelStep = Math.ceil(data.length / 10);

  let yOf: (v: number) => number;
  let zeroY: number;
  if (polarity) {
    const values = data.map((d) => d.value);
    const max = Math.max(...values, 0);
    const min = Math.min(...values, 0);
    const range = max - min || 1;
    yOf = (v) => PAD_T + ((max - v) / range) * PLOT_H;
    zeroY = yOf(0);
  } else {
    const max = Math.max(...data.map((d) => d.value), 1);
    yOf = (v) => PAD_T + PLOT_H - (v / max) * PLOT_H;
    zeroY = PAD_T + PLOT_H;
  }

  return (
    <ChartFrame wrapRef={ref} onLeave={hide}>
      <svg className="h-56 w-full" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img">
        <GridLines ys={[PAD_T, PAD_T + PLOT_H / 2]} />
        <line x1="0" x2={W} y1={zeroY} y2={zeroY} stroke="var(--chart-axis)" strokeWidth="1" />
        {data.map((d, i) => {
          const yVal = yOf(d.value);
          const top = Math.min(yVal, zeroY);
          const h = Math.abs(yVal - zeroY);
          const fill = polarity
            ? d.value >= 0
              ? "var(--chart-pos)"
              : "var(--chart-neg)"
            : "var(--chart-data)";
          return (
            <rect
              key={i}
              // 2px-equivalent gap between adjacent bars, and rounded data-ends.
              x={i * barW + barW * 0.18}
              y={top}
              width={barW * 0.64}
              height={Math.max(h, 1)}
              rx="3"
              fill={fill}
              onMouseMove={(e) => show(e, d.label, polarity ? signed(d.value) : fmt2(d.value))}
            />
          );
        })}
        {data.map((d, i) =>
          i % labelStep === 0 ? (
            <text
              key={i}
              x={i * barW + barW / 2}
              y={H - 14}
              textAnchor="middle"
              fontSize="18"
              fill="var(--color-muted-foreground)"
            >
              {d.short ?? d.label}
            </text>
          ) : null,
        )}
      </svg>
      <Tooltip tip={tip} />
    </ChartFrame>
  );
}

/** Cumulative series as a line, with a zero baseline and hoverable points. */
export function LineChart({ data }: { data: Point[] }) {
  const { ref, tip, show, hide } = useTooltip();
  if (data.length < 1) return <Empty>No settled bets for this period.</Empty>;

  const values = data.map((d) => d.value);
  const max = Math.max(...values, 0);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const stepX = data.length > 1 ? W / (data.length - 1) : 0;
  const yOf = (v: number) => PAD_T + (1 - (v - min) / range) * PLOT_H;
  const zeroY = yOf(0);
  const points = data.map((d, i) => `${i * stepX},${yOf(d.value)}`).join(" ");

  return (
    <ChartFrame wrapRef={ref} onLeave={hide}>
      <svg className="h-56 w-full" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img">
        <GridLines ys={[PAD_T, PAD_T + PLOT_H / 2]} />
        <line x1="0" x2={W} y1={zeroY} y2={zeroY} stroke="var(--chart-axis)" strokeWidth="1" />
        <polyline
          points={points}
          fill="none"
          stroke="var(--chart-data)"
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
        />
        {data.map((d, i) => (
          <circle
            key={i}
            cx={i * stepX}
            cy={yOf(d.value)}
            r="8"
            fill="var(--chart-data)"
            fillOpacity="0.001"
            onMouseMove={(e) => show(e, d.label, signed(d.value))}
          />
        ))}
        {data.length > 1 && (
          <>
            <text
              x="4"
              y={H - 14}
              textAnchor="start"
              fontSize="18"
              fill="var(--color-muted-foreground)"
            >
              {data[0].short ?? data[0].label}
            </text>
            <text
              x={W - 4}
              y={H - 14}
              textAnchor="end"
              fontSize="18"
              fill="var(--color-muted-foreground)"
            >
              {data[data.length - 1].short ?? data[data.length - 1].label}
            </text>
          </>
        )}
      </svg>
      <Tooltip tip={tip} />
    </ChartFrame>
  );
}

/**
 * Win/loss share. Two segments separated by a surface-coloured gap; the losing
 * segment also carries a diagonal hatch so the split survives colour blindness,
 * greyscale printing and forced-colours mode.
 */
export function DonutChart({
  wins,
  losses,
  size = 150,
}: {
  wins: number;
  losses: number;
  size?: number;
}) {
  const total = wins + losses;
  if (!total) return <Empty>No settled bets yet.</Empty>;

  const r = 58;
  const c = 2 * Math.PI * r;
  const gap = wins > 0 && losses > 0 ? 4 : 0;
  const winLen = Math.max((wins / total) * c - gap, 0);
  const lossLen = Math.max((losses / total) * c - gap, 0);
  const pct = Math.round((wins / total) * 100);

  return (
    <svg
      viewBox="0 0 160 160"
      width={size}
      height={size}
      role="img"
      aria-label={`Win rate ${pct} percent: ${wins} won, ${losses} lost`}
    >
      <defs>
        <pattern
          id="lossHatch"
          patternUnits="userSpaceOnUse"
          width="6"
          height="6"
          patternTransform="rotate(45)"
        >
          <rect width="6" height="6" fill="var(--chart-neg)" />
          <line x1="0" y1="0" x2="0" y2="6" stroke="var(--color-card)" strokeWidth="2.5" />
        </pattern>
      </defs>
      {losses > 0 && (
        <circle
          cx="80"
          cy="80"
          r={r}
          fill="none"
          stroke="url(#lossHatch)"
          strokeWidth="20"
          strokeDasharray={`${lossLen} ${c - lossLen}`}
          strokeDashoffset={-((wins / total) * c + gap / 2)}
          transform="rotate(-90 80 80)"
        />
      )}
      {wins > 0 && (
        <circle
          cx="80"
          cy="80"
          r={r}
          fill="none"
          stroke="var(--chart-pos)"
          strokeWidth="20"
          strokeDasharray={`${winLen} ${c - winLen}`}
          strokeDashoffset={gap / 2}
          transform="rotate(-90 80 80)"
        />
      )}
      <text
        x="80"
        y="78"
        textAnchor="middle"
        fontSize="26"
        fontWeight="700"
        fill="var(--color-foreground)"
      >
        {pct}%
      </text>
      <text x="80" y="96" textAnchor="middle" fontSize="12" fill="var(--color-muted-foreground)">
        win rate
      </text>
    </svg>
  );
}
