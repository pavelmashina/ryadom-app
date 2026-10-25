import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import Calendar from "./Calendar";
import TrainingHistory from "./TrainingHistory";
import { blankPet } from "./domain";

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const trainingStyles = source("./training.css");
const history = source("./TrainingHistory.tsx");

describe("Training calendar header and legend match Day", () => {
  it("uses the same month / Today / previous / next order", () => {
    const html = renderToStaticMarkup(
      <TrainingHistory sessions={[]} commands={[]} onOpen={() => {}} onEdit={() => {}} />,
    );
    const month = html.indexOf('class="month training-month"');
    const title = html.indexOf('aria-live="polite"', month);
    const controls = html.indexOf('class="month-controls training-month-controls"', month);
    const today = html.indexOf(">Сегодня</button>", controls);
    const previous = html.indexOf('aria-label="Предыдущий месяц"', controls);
    const next = html.indexOf('aria-label="Следующий месяц"', controls);
    expect(month).toBeGreaterThan(-1);
    expect(title).toBeGreaterThan(month);
    expect(controls).toBeGreaterThan(title);
    expect(today).toBeGreaterThan(controls);
    expect(previous).toBeGreaterThan(today);
    expect(next).toBeGreaterThan(previous);
    expect(history).toContain("setMonth(day.slice(0, 7));");
    expect(history).toContain("setSelection(day);");
    expect(history).toContain("onClick={chooseToday}");
  });

  it("retains both Training indicators in a footer identical to Day's legend slot", () => {
    const html = renderToStaticMarkup(
      <TrainingHistory sessions={[]} commands={[]} onOpen={() => {}} onEdit={() => {}} />,
    );
    const day = renderToStaticMarkup(
      <Calendar
        pet={blankPet("Мася")} selected="2026-10-25" month="2026-10-01"
        setSelected={() => {}} setMonth={() => {}} onAdd={() => {}}
        onTraining={() => {}} onToggle={() => {}} onDetail={() => {}} />,
    );
    expect(day).toContain('class="legend"');
    expect(html).toContain('class="legend calendar-key"');
    expect(html).toContain("Проведено");
    expect(html).toContain("Запланировано");
    expect(html.indexOf('class="training-days"')).toBeLessThan(html.indexOf('class="legend calendar-key"'));
    expect(trainingStyles).toContain("border-top: 1px solid var(--color-border);");
    expect(trainingStyles).toContain("padding-top: var(--space-compact-3);");
    expect(trainingStyles).toContain("margin: var(--space-compact-3) 0 0;");
  });

  it("shares Day's typography, control sizing, and header inset without changing day circles", () => {
    const monthCss = trainingStyles.split(".training-screen .training-month {")[1]?.split("}")[0] || "";
    const titleCss = trainingStyles.split(".training-screen .training-month h3 {")[1]?.split("}")[0] || "";
    const controlsCss = trainingStyles.split(".training-screen .training-month-controls > .btn:not(.icon-button) {")[1]?.split("}")[0] || "";
    expect(monthCss).toContain("justify-content: space-between");
    expect(monthCss).toContain("padding: 0 0 var(--space-compact-3)");
    expect(titleCss).toContain("font-size: var(--font-size-md)");
    expect(titleCss).toContain("text-align: left");
    expect(controlsCss).toContain("font-size: var(--font-size-xs)");
    expect(trainingStyles).toContain("--training-day-size: 44px;");
    expect(trainingStyles).toContain("--training-day-circle: 36px;");
  });
});
