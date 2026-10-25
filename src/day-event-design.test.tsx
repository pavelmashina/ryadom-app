import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import Calendar from "./Calendar";
import EventForm from "./EventForm";
import TrainingTimeField from "./TrainingTimeField";
import { blankPet } from "./domain";

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("Day calendar unified with Training calendar layout", () => {
  it("preserves the month header controls and legend but uses compact circular dates", () => {
    const day = "2026-10-25";
    const html = renderToStaticMarkup(<Calendar
      pet={blankPet("Мася")}
      selected={day} month="2026-10-01"
      setSelected={() => {}} setMonth={() => {}}
      onAdd={() => {}} onTraining={() => {}}
      onToggle={() => {}} onDetail={() => {}}
    />);
    expect(html).toContain('class="day-screen"');
    expect(html).toContain('aria-label="Календарь месяца"');
    for (const text of ["Сегодня", "Предыдущий месяц", "Следующий месяц", "Здоровье", "Занятия", "Уход"])
      expect(html).toContain(text);
    expect(html).toContain("day-date-number");
    expect(html).toContain('aria-current="date"');
    expect(html).toContain('class="legend"');
    expect(html.indexOf('class="month"')).toBeLessThan(html.indexOf('class="dates"'));
    expect(html.indexOf('class="dates"')).toBeLessThan(html.indexOf('class="legend"'));
    const css = source("./styles.css");
    expect(css).toContain("--day-cell-size: 44px;");
    expect(css).toContain("--day-circle-size: 36px;");
    expect(css).toContain(".day-screen .calendar .date.btn .day-date-number");
    expect(css).toContain(".day-screen .calendar .legend");
  });

  it("renders the same date/time input shells as planning a training", () => {
    const html = renderToStaticMarkup(<EventForm
      selected="2026-10-25" onSave={() => {}} />);
    expect(html).toContain("event-editor-modal");
    expect(html).toContain('class="training-date-wrap"');
    expect(html).toContain('class="training-time-wrap is-disabled"');
    expect(html).toContain('name="date"');
    expect(html).toContain('name="time"');
    expect(html).toContain('type="date"');
    expect(html).toContain('type="time"');
    expect(html).toContain('disabled=""');
    expect(html).toContain('class="training-date-value"');
    expect(source("./EventForm.tsx")).toContain("value={startDate}");
    expect(source("./EventForm.tsx")).toContain("disabled={allDay}");
    expect(source("./EventForm.tsx")).toContain('allDay ? "" : text(d, "time")');
  });

  it("preserves the standard compact typography, recurrence and event metadata", () => {
    const src = source("./EventForm.tsx");
    const css = source("./styles.css");
    expect(src).toContain("flatEnd simpleFrequencyLabels monthlyDayPicker");
    expect(src).toContain('name="category"');
    expect(src).toContain('name="name"');
    expect(src).toContain('reminderOffsetMinutes(');
    expect(src).toContain('note: text(d, "note")');
    expect(css).toContain("dialog:has(.event-editor-modal) .modal-content");
    expect(css).toContain(".event-editor-modal .field > label");
    expect(css).toContain("font-size: var(--font-size-md);");
    expect(css).toContain(".event-editor-modal .training-date-wrap input[type=\"date\"]");
    expect(css).toContain(".event-editor-modal .training-time-wrap input[type=\"time\"]");
    expect(css).toContain(".event-editor-modal .form-actions");
  });

  it("does not make optional time controls interactive when all-day", () => {
    const html = renderToStaticMarkup(<TrainingTimeField
      label="Время" name="time" required={false}
      disabled defaultValue="09:00" />);
    expect(html).toContain('class="training-time-wrap is-disabled"');
    expect(html).toContain('disabled=""');
    expect(html).toContain('value="09:00"');
  });
});
