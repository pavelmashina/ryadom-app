import type { Pet } from "./domain";
import { fmt } from "./domain";

type Weight = Pet["weights"][number];

export default function WeightChart({
  measurements, compact = false,
}: { measurements: Weight[]; compact?: boolean }) {
  const ordered = [...measurements].sort((a, b) =>
    a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const points = compact ? ordered.slice(-10) : ordered;
  if (!points.length) return <p className="health-chart-empty">График появится после первого измерения.</p>;
  const values = points.map((x) => x.value);
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const margin = Math.max((maximum - minimum) * 0.2, 0.25);
  const bottom = minimum - margin;
  const range = maximum - minimum + 2 * margin;
  const dates = points.map((x) => Date.parse(x.date + "T12:00:00"));
  const first = Math.min(...dates);
  const span = Math.max(1, Math.max(...dates) - first);
  const positions = points.map((p, i) => ({
    x: points.length === 1 ? 150
      : span === 1 ? 18 + (264 * i) / (points.length - 1)
      : 18 + (264 * (dates[i] - first)) / span,
    y: 88 - (p.value - bottom) / range * 76,
  }));
  const path = positions.map((p, i) =>
    `${i ? "L" : "M"} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(" ");
  return (
    <div className={compact ? "health-chart health-chart-compact" : "health-chart"}>
      <svg viewBox="0 0 300 104" role="img"
        aria-label={`График веса: ${points.length} измерений, от ${minimum.toLocaleString("ru-RU")} до ${maximum.toLocaleString("ru-RU")} кг`}>
        <path className="health-chart-grid" d="M18 25H282 M18 50H282 M18 75H282" />
        {positions.length > 1 && <path className="health-chart-line" d={path} />}
        {positions.map((p, i) => (
          <circle className="health-chart-point" key={points[i].id}
            cx={p.x} cy={p.y} r={i === positions.length - 1 ? 4 : 2.6}>
            <title>{`${fmt(points[i].date)}: ${points[i].value} кг`}</title>
          </circle>
        ))}
      </svg>
      <div className="health-chart-dates">
        <span>{fmt(points[0].date)}</span>
        {points.length > 1 && <span>{fmt(points[points.length - 1].date)}</span>}
      </div>
    </div>
  );
}
