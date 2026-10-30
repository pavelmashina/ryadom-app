import { useState } from "react";
import type { Pet } from "./domain";
import { fmt } from "./domain";

type Weight = Pet["weights"][number];

// Maintain the approved left-axis inset. The chart needs top breathing room,
// while the bottom axis and its date labels move down as one coordinated group.
const EDGE_GAP = 5;
const SIZE = { width: 360, height: 167, right: 357, top: 31, bottom: 141 };
const DATE_LABEL_BASELINE = SIZE.height - EDGE_GAP - 3;
const displayKg = (n: number) => n.toLocaleString("ru-RU", { maximumFractionDigits: 2 });
const stamp = (date: string, includeYear: boolean) =>
  fmt(date, { day: "numeric", month: "short", ...(includeYear ? { year: "2-digit" as const } : {}) });

/** Responsive weight trend with labelled axes and tap/keyboard-accessible point notes. */
export default function WeightChart({
  measurements, compact = false,
}: { measurements: Weight[]; compact?: boolean }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const ordered = [...measurements].sort((a, b) =>
    a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const points = compact ? ordered.slice(-10) : ordered;
  if (!points.length)
    return <p className="health-chart-empty">График появится после первого измерения.</p>;

  const values = points.map((x) => x.value);
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const padding = Math.max((maximum - minimum) * 0.2, 0.25);
  const low = Math.max(0, Math.floor((minimum - padding) * 10) / 10);
  const high = Math.ceil((maximum + padding) * 10) / 10;
  const range = Math.max(0.1, high - low);
  const yTicks = [low, low + range / 2, high];
  // Reserve only the width needed by the tick labels, with a 5px outer gap.
  const left = Math.max(30, Math.ceil(Math.max(...yTicks.map((v) => displayKg(v).length)) * 6.7 + EDGE_GAP + 3));
  const toY = (value: number) =>
    SIZE.bottom - ((value - low) / range) * (SIZE.bottom - SIZE.top);

  const dates = points.map((p) => Date.parse(p.date + "T12:00:00"));
  const first = dates[0];
  const span = dates[dates.length - 1] - first;
  const toX = (date: number, index: number) =>
    points.length === 1 ? (left + SIZE.right) / 2
      : span === 0 ? left + (SIZE.right - left) * index / (points.length - 1)
      : left + (SIZE.right - left) * (date - first) / span;
  const positions = points.map((point, i) => ({
    x: toX(dates[i], i), y: toY(point.value),
  }));
  const path = positions.map((p, i) =>
    `${i ? "L" : "M"} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(" ");
  const includeYear = points[0].date.slice(0, 4) !== points[points.length - 1].date.slice(0, 4);
  const middleIndex = Math.floor((points.length - 1) / 2);
  const middle = positions[middleIndex];
  const xTicks = points.length === 1
    ? [{ x: positions[0].x, date: points[0].date, anchor: "middle" as const }]
    : [
      { x: left, date: points[0].date, anchor: "start" as const },
      ...(points.length >= 5 && middle.x > left + 95 && middle.x < SIZE.right - 95
        ? [{ x: middle.x, date: points[middleIndex].date, anchor: "middle" as const }] : []),
      { x: SIZE.right, date: points[points.length - 1].date, anchor: "end" as const },
    ];
  const selectedIndex = points.findIndex((item) => item.id === selectedId);
  const selected = selectedIndex >= 0 ? points[selectedIndex] : null;
  const dot = selectedIndex >= 0 ? positions[selectedIndex] : null;
  const noteX = dot ? Math.max(3, Math.min(SIZE.width - 149, dot.x - 73)) : 0;
  const noteY = dot ? (dot.y > SIZE.top + 48 ? dot.y - 51 : dot.y + 14) : 0;
  // The most recent value is always visible, independent of tapped point tooltips.
  const latest = points[points.length - 1];
  const latestPosition = positions[positions.length - 1];
  const latestLabel = `${displayKg(latest.value)} кг`;
  const latestLabelWidth = Math.max(50, latestLabel.length * 7 + 14);
  const latestLabelX = Math.max(EDGE_GAP, Math.min(
    SIZE.width - EDGE_GAP - latestLabelWidth,
    latestPosition.x - latestLabelWidth / 2,
  ));
  const latestLabelY = Math.max(EDGE_GAP, latestPosition.y - 29);

  return (
    <div className={compact ? "health-chart health-chart-compact" : "health-chart"}>
      <svg viewBox={`0 0 ${SIZE.width} ${SIZE.height}`} role="group"
        aria-label={`График веса по датам: ${points.length} измерений, от ${displayKg(minimum)} до ${displayKg(maximum)} кг`}>
        <text className="health-chart-axis-unit" x={left} y="21">кг</text>
        {yTicks.map((tick, i) => {
          const y = toY(tick);
          return <g key={i}>
            <line className="health-chart-grid" x1={left} x2={SIZE.right} y1={y} y2={y} />
            <text className="health-chart-axis-label" x={left - 3} y={y + 4}
              textAnchor="end">{displayKg(tick)}</text>
          </g>;
        })}
        <line className="health-chart-axis" x1={left} x2={left}
          y1={SIZE.top} y2={SIZE.bottom} />
        <line className="health-chart-axis" x1={left} x2={SIZE.right}
          y1={SIZE.bottom} y2={SIZE.bottom} />
        {positions.length > 1 && <path className="health-chart-line" d={path} />}
        {positions.map((p, i) => {
          const point = points[i];
          const isSelected = point.id === selectedId;
          const toggle = () => setSelectedId(isSelected ? null : point.id);
          return <g key={point.id} className="health-chart-point-hit" role="button"
            tabIndex={0} aria-pressed={isSelected}
            aria-label={`${fmt(point.date, {day:"numeric",month:"long",year:"numeric"})}, ${displayKg(point.value)} кг`}
            onClick={toggle}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                toggle();
              }
              if (event.key === "Escape") setSelectedId(null);
            }}>
            <circle className="health-chart-hitarea" cx={p.x} cy={p.y} r={15} />
            <circle className="health-chart-point" cx={p.x} cy={p.y}
              r={isSelected || i === points.length - 1 ? 4 : 2.8}
              pointerEvents="none" />
          </g>;
        })}
        {xTicks.map((tick, i) => <g key={i}>
          <line className="health-chart-axis" x1={tick.x} x2={tick.x}
            y1={SIZE.bottom} y2={SIZE.bottom + 4} />
          <text className="health-chart-axis-label" x={tick.x} y={DATE_LABEL_BASELINE}
            textAnchor={tick.anchor}>{stamp(tick.date, includeYear)}</text>
        </g>)}
        <g className="health-chart-latest" pointerEvents="none"
          aria-label={`Последнее измерение: ${latestLabel}`}>
          <rect x={latestLabelX} y={latestLabelY} width={latestLabelWidth} height={20} rx={6} />
          <text x={latestLabelX + latestLabelWidth / 2} y={latestLabelY + 14}
            textAnchor="middle">{latestLabel}</text>
        </g>
        {selected && dot && (
          <g className="health-chart-note" pointerEvents="none" aria-hidden="true">
            <rect x={noteX} y={noteY} width={146} height={42} rx={8} />
            <text x={noteX + 9} y={noteY + 16}>
              {fmt(selected.date, { day: "numeric", month: "short", year: "numeric" })}
            </text>
            <text className="health-chart-note-weight" x={noteX + 9} y={noteY + 33}>
              {displayKg(selected.value)} кг
            </text>
          </g>
        )}
      </svg>
    </div>
  );
}
