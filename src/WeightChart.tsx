import type { Pet } from "./domain";
import { fmt } from "./domain";

type Weight = Pet["weights"][number];

const SIZE = { width: 340, height: 162, left: 47, right: 328, top: 12, bottom: 119 };
const displayKg = (n: number) => n.toLocaleString("ru-RU", { maximumFractionDigits: 2 });
const stamp = (date: string, includeYear: boolean) =>
  fmt(date, { day: "numeric", month: "short", ...(includeYear ? { year: "2-digit" as const } : {}) });

/** The compact trend chart has labelled kilogram and date axes, even for a single reading. */
export default function WeightChart({
  measurements, compact = false,
}: { measurements: Weight[]; compact?: boolean }) {
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
  const toY = (value: number) =>
    SIZE.bottom - ((value - low) / range) * (SIZE.bottom - SIZE.top);

  const dates = points.map((p) => Date.parse(p.date + "T12:00:00"));
  const first = dates[0];
  const span = dates[dates.length - 1] - first;
  const toX = (date: number, index: number) =>
    points.length === 1 ? (SIZE.left + SIZE.right) / 2
      : span === 0 ? SIZE.left + (SIZE.right - SIZE.left) * index / (points.length - 1)
      : SIZE.left + (SIZE.right - SIZE.left) * (date - first) / span;
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
      { x: SIZE.left, date: points[0].date, anchor: "start" as const },
      ...(points.length >= 5 && middle.x > SIZE.left + 95 && middle.x < SIZE.right - 95
        ? [{ x: middle.x, date: points[middleIndex].date, anchor: "middle" as const }] : []),
      { x: SIZE.right, date: points[points.length - 1].date, anchor: "end" as const },
    ];

  return (
    <div className={compact ? "health-chart health-chart-compact" : "health-chart"}>
      <svg viewBox={`0 0 ${SIZE.width} ${SIZE.height}`} role="img"
        aria-label={`График веса по датам: ${points.length} измерений, от ${displayKg(minimum)} до ${displayKg(maximum)} кг`}>
        <text className="health-chart-axis-unit" x={SIZE.left} y="9">кг</text>
        {yTicks.map((tick, i) => {
          const y = toY(tick);
          return <g key={i}>
            <line className="health-chart-grid" x1={SIZE.left} x2={SIZE.right} y1={y} y2={y} />
            <text className="health-chart-axis-label" x={SIZE.left - 8} y={y + 3}
              textAnchor="end">{displayKg(tick)}</text>
          </g>;
        })}
        <line className="health-chart-axis" x1={SIZE.left} x2={SIZE.left}
          y1={SIZE.top} y2={SIZE.bottom} />
        <line className="health-chart-axis" x1={SIZE.left} x2={SIZE.right}
          y1={SIZE.bottom} y2={SIZE.bottom} />
        {positions.length > 1 && <path className="health-chart-line" d={path} />}
        {positions.map((p, i) => <circle className="health-chart-point" key={points[i].id}
          cx={p.x} cy={p.y} r={i === points.length - 1 ? 4 : 2.6}>
          <title>{`${fmt(points[i].date)}: ${displayKg(points[i].value)} кг`}</title>
        </circle>)}
        {xTicks.map((tick, i) => <g key={i}>
          <line className="health-chart-axis" x1={tick.x} x2={tick.x}
            y1={SIZE.bottom} y2={SIZE.bottom + 4} />
          <text className="health-chart-axis-label" x={tick.x} y={SIZE.bottom + 17}
            textAnchor={tick.anchor}>{stamp(tick.date, includeYear)}</text>
        </g>)}
      </svg>
    </div>
  );
}
