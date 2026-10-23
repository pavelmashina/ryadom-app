import { describe,expect,it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { blankPet } from "./domain";
import type { TrainingSession } from "./training-domain";
import type { TrainingSchedule } from "./training-planning";
import { cancelPlannedTraining } from "./training-actions";
import TrainingHistory from "./TrainingHistory";

const source=(path:string)=>readFileSync(new URL(path,import.meta.url),"utf8");
const training=source("./Training.tsx");
const history=source("./TrainingHistory.tsx");
const planner=source("./TrainingPlan.tsx");
const css=source("./training.css");
const stock=source("./stock.css");
const global=source("./styles.css");
const tokens=source("./tokens.css");

const scheduleId="123e4567-e89b-42d3-a456-426614174010";
const scheduled:TrainingSchedule={
 id:scheduleId,name:"Тренировка",starts_on:"2026-10-01",ends_on:null,
 recurrence_frequency:"weekly",recurrence_interval:1,
 recurrence_end_type:"never",recurrence_count:null,recurrence_monthday:null,
 repeat_type:"weekdays",weekdays:[5],time_of_day:"15:00",is_active:true,
 comment:"",command_ids:[],
};
function workout(id:string,date:string,status:"planned"|"completed"="planned",schedule_id:string|null=scheduleId):TrainingSession{
 return {
  id,date,status,schedule_id,
  created_at:date+"T13:00:00Z",updated_at:date+"T13:00:00Z",
  scheduled_at:date+"T12:00:00Z",completed_at:status==="completed"?date+"T12:00:00Z":null,
  name:"Тренировка",time:"15:00",duration_minutes:null,comment:"",
  results:status==="completed"?[{command_id:"cmd",performance_score:5,mode:"repeat",comment:""}]:[],
 };
}
function fixture(){
 const pet=blankPet("Питомец");
 return {...pet,trainingSchedules:[scheduled],workouts:[
  workout("123e4567-e89b-42d3-a456-426614174101","2026-10-16","completed"),
  workout("123e4567-e89b-42d3-a456-426614174102","2026-10-23"),
  workout("123e4567-e89b-42d3-a456-426614174103","2026-10-30"),
  workout("123e4567-e89b-42d3-a456-426614174104","2026-11-06"),
  workout("123e4567-e89b-42d3-a456-426614174105","2026-10-30","planned",null),
 ]};
}
describe("Scheduled training editor and cancellation",()=>{
 it("keeps a single cancelled occurrence as an exception without touching neighbors",()=>{
  const original=fixture(),next=cancelPlannedTraining(original,original.workouts[1].id,"one");
  expect(next.workouts[1].status).toBe("cancelled");
  expect(next.workouts[2].status).toBe("planned");
  expect(next.workouts[0].status).toBe("completed");
  expect(next.trainingSchedules).toEqual(original.trainingSchedules);
 });
 it("ends a recurring schedule before the chosen date, leaving completed sessions untouched",()=>{
  const original=fixture(),next=cancelPlannedTraining(original,original.workouts[2].id,"following");
  expect(next.workouts.map(x=>x.status)).toEqual(["completed","planned","cancelled","cancelled","planned"]);
  expect(next.trainingSchedules?.[0].ends_on).toBe("2026-10-29");
  expect(next.trainingSchedules?.[0].recurrence_end_type).toBe("date");
  expect(next.trainingSchedules?.[0].is_active).toBe(true);
 });
 it("disables a schedule when its first occurrence is cancelled with all following",()=>{
  const original=fixture();
  original.trainingSchedules![0]={...scheduled,starts_on:"2026-10-23"};
  const next=cancelPlannedTraining(original,original.workouts[1].id,"following");
  expect(next.trainingSchedules?.[0].is_active).toBe(false);
  expect(next.trainingSchedules?.[0].ends_on).toBeNull();
 });
 it("never cancels completed sessions or unrelated one-offs with the future option",()=>{
  const pet=fixture();
  expect(()=>cancelPlannedTraining(pet,pet.workouts[0].id,"one")).toThrow("только запланированную");
  expect(()=>cancelPlannedTraining(pet,pet.workouts[4].id,"following")).toThrow("нет регулярного");
 });
 it("does not expose details or separate reschedule controls on planned calendar cards",()=>{
  const pet=fixture();
  const html=renderToStaticMarkup(<TrainingHistory
    sessions={[pet.workouts[1]]} commands={pet.commands}
    onOpen={()=>{}} onEdit={()=>{}}/>);
  expect(html).toContain("Запланирована");
  expect(html).toContain("Редактировать");
  expect(html).not.toContain(">Подробнее</button>");
  expect(html).not.toContain(">Перенести</button>");
  expect(training).not.toContain("<summary>Регулярный график</summary>");
 });
 it("links a planned occurrence to its schedule and has a choice confirmation step",()=>{
  expect(training).toContain('schedule:pet.trainingSchedules?.find(sc => sc.id === session.schedule_id)');
  expect(training).toContain('kind: "cancel"');
  expect(training).toContain("Удалить только эту тренировку");
  expect(training).toContain("Удалить эту и все последующие");
  expect(training).toContain('confirmCancel(view.session, "following")');
  expect(training).toContain("cancelBusy");
  expect(planner).toContain('allowedFrequencies={schedule');
  expect(planner).toContain("workouts: session && !schedule");
 });
 it("uses an inline check without the extra selected label",()=>{
  expect(training).toContain('className="command-choice-check"');
  expect(training).not.toContain("✓ Выбрана");
  expect(css).toContain(".training-modal-content .command-choice-check");
 });
 it("keeps an app-wide field text inset and standard-sized end-range control",()=>{
  expect(tokens).toContain("--field-control-inline: var(--space-compact-6)");
  expect(global).toContain("padding: var(--space-3) var(--field-control-inline)");
  expect(stock).toContain("padding: var(--space-compact-3) var(--field-control-inline)");
  expect(css).toContain("padding: var(--space-compact-3) var(--field-control-inline)");
  expect(css).toContain(".recurrence-options-flat-end .field select {");
  expect(css).toContain("height: var(--button-height-sm)");
  expect(css).toContain("gap: 1px");
  expect(css).toContain("width: 18px");
 });
});
