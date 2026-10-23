import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { blankPet } from "./domain";
import TrainingPlan, { validatePlanningInterval } from "./TrainingPlan";
import TrainingTimeField from "./TrainingTimeField";

const source=(path:string)=>readFileSync(new URL(path, import.meta.url),"utf8");
const plan=source("./TrainingPlan.tsx");
const recurrence=source("./RecurrenceFields.tsx");
const css=source("./training.css");
const training=source("./Training.tsx");

describe("Compact training planner",()=>{
 it("offers simple repetition units, without title, comment or scheduling help",()=>{
  const html=renderToStaticMarkup(<TrainingPlan pet={blankPet("Пёс")} onSave={async()=>{}}/>);
  expect(html).toContain(">День</option>");
  expect(html).toContain(">Неделя</option>");
  expect(html).toContain(">Месяц</option>");
  expect(html).toContain(">Год</option>");
  expect(html).not.toContain("Название · необязательно");
  expect(html).not.toContain("Комментарий");
  expect(plan).toContain("schedule?.name || session?.name ||");
  expect(plan).toContain("schedule?.comment ?? session?.comment ??");
  expect(plan).not.toContain("Плановые занятия формируются");
  expect(plan).toContain("simpleFrequencyLabels");
 });
 it("guards an empty, decimal, negative or out-of-range period without writing",()=>{
  for (const text of ["", " ", "0", "-1", "1.5", "367", "anything"])
    expect(()=>validatePlanningInterval(text,"monthly")).toThrow("Укажите периодичность");
  expect(validatePlanningInterval("1","daily")).toBe(1);
  expect(validatePlanningInterval("14","monthly")).toBe(14);
  expect(validatePlanningInterval("","once")).toBe(1);
  expect(recurrence).toContain("value={intervalText ?? value.interval}");
  expect(recurrence).toContain("onIntervalTextChange?.(raw)");
  expect(plan).toContain("onIntervalTextChange={setIntervalText}");
  expect(plan).toContain("recurrence_interval: interval");
 });
 it("constrains native time control inside the same visible width as the date",()=>{
  const html=renderToStaticMarkup(<TrainingTimeField label="Время" name="time" defaultValue="18:30"/>);
  expect(html).toContain('type="time"');
  expect(html).toContain('class="training-time-wrap"');
  expect(html).toContain("18:30");
  expect(css).toContain(".training-time-wrap {");
  expect(css).toContain("max-inline-size: 100%");
  expect(css).toContain('.training-modal-content .training-time-wrap input[type="time"]');
  expect(plan).toContain("<TrainingTimeField");
 });
 it("compacts inner periodicity labels and controls and uses tighter evaluation card corners",()=>{
  expect(css).toContain(".training-planner-recurrence .recurrence-options-flat-frequency .fields {");
  expect(css).toContain("font-size: var(--font-size-xs)");
  expect(css).toContain("border-radius: var(--radius-sm)");
  expect(training).not.toContain("Длительность не указана");
  expect(training).toContain('selected.duration_minutes ? " · "');
 });
});
