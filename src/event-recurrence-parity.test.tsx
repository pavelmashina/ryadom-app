import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import EventForm from "./EventForm";
import TrainingPlan, { validatePlanningInterval, validateMonthlyRepeatDay } from "./TrainingPlan";
import { blankPet } from "./domain";

const file = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const form = file("./EventForm.tsx");
const styles = file("./training.css");

describe("New Event recurrence matches Schedule Training", () => {
  it("removes the shared-notifications comment from New Event", () => {
    const html = renderToStaticMarkup(<EventForm selected="2026-10-25" onSave={() => {}} />);
    expect(html).toContain("Напомнить");
    expect(html).not.toContain("Уведомления получают");
    expect(html).not.toContain("Уведомления об окончании запасов");
    expect(html).not.toContain("напоминание сохраняется лично");
  });

  it("uses the same recurrence component and all planner settings", () => {
    const plan = renderToStaticMarkup(<TrainingPlan
      pet={blankPet("Питомец")} initialDate="2026-10-25" onSave={async () => {}} />);
    const event = renderToStaticMarkup(<EventForm
      selected="2026-10-25" onSave={async () => {}} />);
    for (const label of ["Повторение", "Не повторять", "День", "Неделя", "Месяц", "Год"])
      expect(event).toContain(label);
    expect(event).toContain('class="training-planner-recurrence"');
    expect(plan).toContain('class="training-planner-recurrence"');
    for (const prop of ["flatEnd", "simpleFrequencyLabels", "monthlyDayPicker",
      "intervalText={intervalText}", "onIntervalTextChange={setIntervalText}"]) {
      expect(form).toContain(prop);
      expect(file("./TrainingPlan.tsx")).toContain(prop);
    }
  });

  it("applies Training's exact scope to condensed interval / weekly / monthly / end controls", () => {
    const scope = ":is(.training-modal-content, .event-editor-modal)";
    expect(styles).toContain(scope + " .training-planner-recurrence");
    expect(styles).toContain(scope + " .weekdays-picker-row");
    expect(styles).toContain(scope + " .training-planner-recurrence .monthly-day-picker");
    expect(styles).toContain(scope + " .training-planner-recurrence .monthly-day-control");
    expect(styles).toContain(scope + " .training-planner-recurrence .monthly-day-picker .monthly-last-day");
    expect(styles).toContain("grid-template-columns: repeat(7, minmax(0, 1fr))");
    expect(styles).toContain("height: 36px");
    expect(styles).toContain("font-size: var(--font-size-xs)");
    expect(styles).toContain("padding-left: var(--field-control-inline)");
  });

  it("validates the same input intervals and last-day monthly choice", () => {
    expect(form).toContain("validatePlanningInterval(intervalText, recurrence.frequency)");
    expect(form).toContain("validateMonthlyRepeatDay(recurrence.frequency, recurrence.monthday)");
    expect(form).toContain("repeatInterval: recurrence.frequency === \"once\" ? undefined : interval");
    for (const invalid of ["", "0", "1.5", "-2", "367", "hi"])
      expect(() => validatePlanningInterval(invalid, "monthly")).toThrow();
    expect(validatePlanningInterval("2", "weekly")).toBe(2);
    expect(validatePlanningInterval("", "once")).toBe(1);
    expect(() => validateMonthlyRepeatDay("monthly", 0)).toThrow();
    expect(() => validateMonthlyRepeatDay("monthly", 32)).not.toThrow();
  });
});
