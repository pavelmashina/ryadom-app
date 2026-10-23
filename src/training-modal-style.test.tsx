import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import TrainingDateField from "./TrainingDateField";
import { commandProgress, type TrainingSession } from "./training-domain";

const training=readFileSync(new URL("./Training.tsx",import.meta.url),"utf8");
const planner=readFileSync(new URL("./TrainingPlan.tsx",import.meta.url),"utf8");
const styles=readFileSync(new URL("./training.css",import.meta.url),"utf8");
const recurrence=readFileSync(new URL("./RecurrenceFields.tsx",import.meta.url),"utf8");

describe("Compact training editors",()=>{
 it("keeps the native picker usable while drawing its date border inside the form",()=>{
  const markup=renderToStaticMarkup(<TrainingDateField label="Дата тренировки" name="date" defaultValue="2026-10-23" required/>);
  expect(markup).toContain('class="training-date-wrap"');
  expect(markup).toContain('type="date"');
  expect(markup).toContain('name="date"');
  expect(markup).toContain("23");
  expect(styles).toContain(".training-date-wrap {");
  expect(styles).toContain("max-inline-size:100%");
  expect(styles).toContain('opacity:0;cursor:pointer');
  expect(training).toContain('<TrainingDateField');
  expect(planner).toContain('<TrainingDateField');
  expect(recurrence).toContain('flatEnd ? (');
 });
 it("styles portal-based forms as compact stock editors",()=>{
  expect(training).toContain('className="training-modal-content"');
  expect(styles).toContain("dialog:has(.training-modal-content) .modal-content");
  expect(styles).toContain("font-size:var(--font-size-md)");
  expect(styles).toContain("font-size:var(--font-size-sm)");
  expect(styles).toContain(".training-modal-content .command-list {");
 });
 it("does not display Choose for commands, and prevents tap focus returning to the grid",()=>{
  expect(training).not.toContain(' : "Выбрать"');
  expect(training).toContain('if (event.detail > 0) event.currentTarget.blur()');
  const grid=readFileSync(new URL("./CommandGrid.tsx",import.meta.url),"utf8");
  expect(grid).toContain('tabIndex={scroll.overflow ? 0 : undefined}');
 });
 it("uses the latest nonempty command comment, not just the latest training",()=>{
  const entry=(id:string,date:string,comment:string):TrainingSession=>({
   id,date,status:"completed",name:"Тренировка",time:"",
   duration_minutes:null,comment:"",created_at:date+"T10:00:00Z",
   updated_at:date+"T10:00:00Z",
   results:[{command_id:"one",performance_score:4,mode:"repeat",comment}],
  });
  const progress=commandProgress([
   entry("older","2026-10-21","Улучшилось выполнение"),
   entry("latest","2026-10-23",""),
  ],"one");
  const latest=progress.history.find(x=>x.result.comment.trim())?.result.comment.trim();
  expect(latest).toBe("Улучшилось выполнение");
  expect(training).toContain('progress.history.find((x) => x.result.comment.trim())');
  expect(training).toContain("Последний комментарий к команде");
 });
});
