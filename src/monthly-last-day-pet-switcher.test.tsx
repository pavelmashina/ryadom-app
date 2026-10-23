import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { validateMonthlyRepeatDay } from "./TrainingPlan";
import { occurrenceIndex } from "./recurrence";
const source=(p:string)=>readFileSync(new URL(p,import.meta.url),"utf8");
const recurrence=source("./RecurrenceFields.tsx");
const planner=source("./TrainingPlan.tsx");
const trainingSchema=source("./training-planning.ts");
const css=source("./training.css");
const app=source("./App.tsx");
const styles=source("./styles.css");
const calendar=source("./Calendar.tsx");
const account=source("./Account.tsx");
const migration=source("../supabase/migrations/20261023155807_training_month_last_day_choice.sql");

describe("Monthly training plan choices",()=>{
  it("requires one chosen monthly day or explicit last-day option",()=>{
    expect(()=>validateMonthlyRepeatDay("monthly",0)).toThrow("Выберите число месяца");
    expect(()=>validateMonthlyRepeatDay("monthly",NaN)).toThrow("Выберите число месяца");
    expect(()=>validateMonthlyRepeatDay("monthly",33)).toThrow();
    expect(()=>validateMonthlyRepeatDay("monthly",1)).not.toThrow();
    expect(()=>validateMonthlyRepeatDay("monthly",31)).not.toThrow();
    expect(()=>validateMonthlyRepeatDay("monthly",32)).not.toThrow();
    expect(()=>validateMonthlyRepeatDay("weekly",0)).not.toThrow();
    expect(planner).toContain("validateMonthlyRepeatDay(recurrence.frequency, recurrence.monthday)");
  });
  it("opens a native compact number menu and mutually exclusive last-day checkbox",()=>{
    expect(planner).toContain("monthlyDayPicker");
    expect(recurrence).toContain('className="monthly-day-picker"');
    expect(recurrence).toContain('label="Число месяца"');
    expect(recurrence).toContain('Array.from({length:31}');
    expect(recurrence).toContain('label="Последнее число месяца"');
    expect(recurrence).toContain('checked={value.monthday === 32}');
    expect(recurrence).toContain('disabled={value.monthday === 32}');
    expect(recurrence).toContain('monthday:e.target.checked ? 32 : 0');
    expect(recurrence).toContain('frequency === "monthly" && value.frequency !== "monthly"');
    expect(css).toContain(".monthly-day-picker .field select {");
    expect(css).toContain("flex: 0 0 104px;");
    expect(trainingSchema).toContain('recurrence_monthday: z.number().int().min(1).max(32)');
    expect(migration).toContain("recurrence_monthday between 1 and 32");
    expect(migration).toContain("day_of_month between 1 and 32");
  });
  it("treats 32 as actual last day, not the 31st, when a month is shorter",()=>{
    const config={date:"2026-01-31",repeat:"monthly" as const,repeatInterval:1,repeatMonthday:32};
    expect(occurrenceIndex(config,"2026-02-28")).not.toBeNull();
    expect(occurrenceIndex(config,"2028-02-29")).not.toBeNull();
    expect(occurrenceIndex(config,"2026-04-30")).not.toBeNull();
    expect(occurrenceIndex(config,"2026-03-30")).toBeNull();
  });
});

describe("Unified compact pet menu and screen typography",()=>{
  it("locks all background scrolling and closes the menu by touching outside",()=>{
    expect(app).toContain('html.style.overflow = "hidden"');
    expect(app).toContain('body.style.overflow = "hidden"');
    expect(app).toContain('window.addEventListener("keydown",closeOnEscape)');
    expect(app).toContain('aria-label="Закрыть список питомцев"');
    expect(app).toContain('onClick={()=>setPetMenuOpen(false)}');
    expect(app).toContain('<ChevronDown className="pet-switcher-chevron"/>');
    expect(styles).toContain('background:var(--color-overlay)');
    expect(styles).toContain('touch-action:none');
    expect(styles).toContain('.pet-button[aria-expanded="true"] .pet-switcher-chevron');
    expect(styles).toContain('transform: rotate(180deg)');
  });
  it("uses matching form and account typography with fewer introductory labels",()=>{
    expect(app).toContain('className="new-pet-form"');
    expect(styles).toContain(".new-pet-form .field > label");
    expect(styles).toContain(".account-content .field > label");
    expect(styles).toContain("padding:var(--space-compact-3) var(--field-control-inline)");
    expect(account).toContain('<PageHeader title="Аккаунт" />');
    expect(account).not.toContain("Ваше пространство");
    expect(account).not.toContain("Управление входом и безопасностью");
    expect(calendar).not.toContain("Забота каждый день");
    expect(calendar).not.toContain("Всё важное для");
    expect(calendar).toContain('<PageHeader title="Наши планы" />');
  });
});
