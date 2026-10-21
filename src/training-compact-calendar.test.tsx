import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import TrainingHistory from "./TrainingHistory";
import { monthDays } from "./training-calendar";
import type { TrainingSession } from "./training-domain";

const css = readFileSync(new URL("./training.css", import.meta.url), "utf8");
const source = readFileSync(new URL("./TrainingHistory.tsx", import.meta.url), "utf8");
const date = (n: number) => "2026-10-" + String(n).padStart(2, "0");
const session = (n: number, status: "planned" | "completed" = "completed"): TrainingSession => ({
  id: "session-" + n + "-" + status,
  date: date(n),
  status,
  name: "Тренировка",
  time: "18:00",
  scheduled_at: date(n) + "T15:00:00Z",
  completed_at: status === "completed" ? date(n) + "T16:00:00Z" : null,
  created_at: date(n) + "T15:00:00Z",
  updated_at: date(n) + "T15:00:00Z",
  duration_minutes: status === "completed" ? 35 : null,
  comment: "",
  results: [],
});
function cells(marked: TrainingSession[]) {
  const html = renderToStaticMarkup(
    <TrainingHistory
      sessions={marked}
      commands={[]}
      onOpen={() => {}}
      onEdit={() => {}}
    />,
  );
  const buttons = html.match(/<button\b[^>]*class="training-day"[^>]*>[\s\S]*?<\/button>/g) ?? [];
  return { html, buttons };
}

describe("Training calendar geometry (#162–176)", () => {
  it("renders 1, 8, 11, 28 and 31 in identical number+marker slots", () => {
    const days = [1, 8, 11, 28, 31];
    const { buttons } = cells(days.map((n) => session(n)));
    expect(buttons).toHaveLength(31);
    for (const n of days) {
      const button = buttons.find((item) => item.includes('aria-label="' + n + ' октября'));
      expect(button).toBeDefined();
      expect(button).toContain('<span class="training-day-number">' + n + "</span>");
      expect(button).toContain('<span class="training-day-markers" aria-hidden="true">');
      expect(button).toContain('<span class="training-day-dot"></span>');
    }
    expect(source).not.toContain("left: calc(50%");
  });

  it("keeps an empty marker slot when a day has no training", () => {
    const { buttons } = cells([session(8)]);
    const day7 = buttons.find((item) => item.includes('aria-label="7 октября'));
    const day8 = buttons.find((item) => item.includes('aria-label="8 октября'));
    expect(day7).toContain('<span class="training-day-markers" aria-hidden="true"></span>');
    expect(day8).toContain('<span class="training-day-dot"></span>');
    expect(day7).toContain('class="training-day-number"');
    expect(day8).toContain('class="training-day-number"');
  });

  it("centers simultaneous completed and planned indicators without offsets", () => {
    const { buttons } = cells([session(28), session(28, "planned")]);
    const day = buttons.find((item) => item.includes('aria-label="28 октября'));
    expect(day).toContain('class="training-day-markers both"');
    expect(day).toContain('class="training-day-dot"');
    expect(day).toContain('class="training-day-planned"');
    expect(css).toContain(".training-screen .training-day-markers.both");
    expect(css).toContain("position: absolute;");
    expect(css).not.toContain("calc(50% - 7px)");
    expect(css).not.toContain("calc(50% + 2px)");
  });

  it("uses fixed 44px grid rows and a single 7-column alignment for weekdays", () => {
    expect(monthDays("2027-02")).toHaveLength(28);
    expect(monthDays("2026-03")).toHaveLength(42);
    // Month height changes only if the number of actual week rows changes.
    expect(css).toContain("grid-auto-rows: var(--training-day-size)");
    expect(css).toContain("grid-template-columns: repeat(7, minmax(0, 1fr))");
    const sharedGridRule = css.match(/\.training-screen \.training-weekdays,\s*\.training-screen \.training-days\s*\{([^}]+)\}/);
    expect(sharedGridRule?.[1]).toContain("grid-template-columns: repeat(7, minmax(0, 1fr))");
    expect(sharedGridRule?.[1]).toContain("gap: 0;");
  });

  it("uses 12px XS for helper labels, with more compact card spacing", () => {
    for (const selector of [".training-weekdays span", ".calendar-key", ".training-session-date"]) {
      const rule = css.split(".training-screen " + selector + " {")[1]?.split("}")[0] ?? "";
      expect(rule).toContain("font-size: var(--font-size-xs);");
    }
    const card = css.split(".training-screen .training-session-summary.card {")[1]?.split("}")[0] ?? "";
    expect(card).toContain("padding: var(--space-compact-4);");
    expect(card).toContain("margin: 0 0 var(--space-compact-3);");
    expect(css).toContain("grid-template-rows: repeat(2, var(--button-height-sm))");
  });
});
