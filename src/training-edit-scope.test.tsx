import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { blankPet } from "./domain";
import TrainingPlan from "./TrainingPlan";
import { applyTrainingEditScope, continuationSchedule } from "./training-edit-scope";
import type { TrainingSchedule } from "./training-planning";
import type { TrainingSession } from "./training-domain";

const read=(p:string)=>readFileSync(new URL(p,import.meta.url),"utf8");
const app=read("./App.tsx");
const training=read("./Training.tsx");
const plan=read("./TrainingPlan.tsx");
const css=read("./training.css");

const seriesId="19b70874-9217-4955-9d9d-44d8176fb711";
const contId="be1b2027-a70a-429a-8524-aee880ac150d";
const baseSchedule: TrainingSchedule={
  id:seriesId,name:"Тренировка",time_of_day:"20:00",repeat_type:"weekdays",
  weekdays:[1,3],starts_on:"2026-10-19",ends_on:"2026-12-30",
  recurrence_frequency:"weekly",recurrence_interval:1,
  recurrence_end_type:"date",recurrence_count:null,recurrence_monthday:null,
  is_active:true,comment:"",command_ids:[],
};
function workout(date:string,status:"planned"|"completed"="planned"):TrainingSession {
  return {
    id:`${date.slice(8)}000000-0000-4000-8000-000000000000`,
    date,time:"20:00",name:"Тренировка",schedule_id:seriesId,status,
    scheduled_at:date+"T17:00:00.000Z",completed_at:status==="completed"?date+"T17:00:00.000Z":null,
    duration_minutes:status==="completed"?60:null,comment:"",
    created_at:date+"T00:00:00.000Z",updated_at:date+"T00:00:00.000Z",
    results:status==="completed"?[{command_id:"cmd",performance_score:5,mode:"repeat",comment:""}]:[],
  };
}
function fixture(){
  const pet=blankPet("Мася");
  pet.trainingSchedules=[baseSchedule];
  pet.workouts=[workout("2026-10-19","completed"),workout("2026-10-26"),workout("2026-10-28")];
  return pet;
}

describe("One shared edit training dialog on Day and Training",()=>{
  it("uses one shared planner with identical style and title from both entry points",()=>{
    expect(app).toContain('<TrainingPlan pet={pet} auth={session} session={workout}');
    expect(training).toContain("<TrainingPlan");
    expect(app).toContain('"training-modal-content training-day-modify"');
    expect(training).toContain('<div className="training-modal-content">');
    expect(app).toContain('"Редактировать тренировку"');
    expect(training).toContain('view.session || view.schedule ? "Редактировать тренировку"');
    expect(plan).toContain('className="training-plan-editor"');
    expect(plan).toContain("<TrainingPlanFields");
    expect(training).not.toContain('view.session?.status === "planned" && <Button fullWidth variant="secondary"');
  });
  it("shows three edit scopes before the same fields",()=>{
    const pet=fixture();
    const html=renderToStaticMarkup(<TrainingPlan pet={pet} session={pet.workouts[1]}
      schedule={baseSchedule} onSave={async()=>{}}/>);
    for (const label of ["Только эту тренировку","Эту и все последующие","Все тренировки серии","Изменить"])
      expect(html).toContain(label);
    expect(html).toContain('value="all" selected=""');
    expect(html).toContain("Повторение");
    expect(html).toContain("Напомнить");
    expect(plan).toContain('key={recurring ? scope : session?.id ?? schedule?.id ?? "new"}');
    expect(plan).toContain('onlySingle={recurring && scope === "single"}');
    expect(plan).toContain('initiallyExpanded={!!schedule}');
    expect(plan).toContain('scope === "all" ? schedule.starts_on : session.date');
  });
  it("edits only one session without touching its schedule and prior records",()=>{
    const pet=fixture();
    const result={...pet,workouts:pet.workouts.map((w,i)=>i===1?{...w,time:"21:00"}:w)};
    expect(applyTrainingEditScope(result,pet.workouts[1],baseSchedule,"single")).toEqual(result);
    expect(result.trainingSchedules).toEqual(pet.trainingSchedules);
  });
  it("splits this-and-following off the old plan and preserves history",()=>{
    const pet=fixture();
    const continuation={...continuationSchedule(baseSchedule,pet.workouts[1],contId),time_of_day:"21:00"};
    const candidate={...pet,trainingSchedules:[baseSchedule,continuation]};
    const next=applyTrainingEditScope(candidate,pet.workouts[1],baseSchedule,"future");
    expect(next.trainingSchedules?.[0].ends_on).toBe("2026-10-25");
    expect(next.trainingSchedules?.[0].recurrence_end_type).toBe("date");
    expect(next.trainingSchedules?.[1]).toEqual(continuation);
    expect(next.workouts.map(w=>w.status)).toEqual(["completed"]);
    expect(next.workouts[0].id).toBe(pet.workouts[0].id);
  });
  it("preserves completed training while rebuilding an edited full series",()=>{
    const pet=fixture();
    const changed={...pet,trainingSchedules:[{...baseSchedule,time_of_day:"21:00"}]};
    const next=applyTrainingEditScope(changed,pet.workouts[1],baseSchedule,"all");
    expect(next.workouts.filter(w=>w.status==="completed")).toHaveLength(1);
    expect(next.trainingSchedules?.[0].time_of_day).toBe("21:00");
    expect(applyTrainingEditScope(pet,pet.workouts[1],baseSchedule,"all")).toEqual(pet);
  });
  it("preserves the remaining count on a future-only counted recurrence",()=>{
    const schedule={...baseSchedule,recurrence_end_type:"count" as const,
      recurrence_count:5,ends_on:null};
    const date=workout("2026-10-28");
    const next=continuationSchedule(schedule,date,contId);
    expect(next.starts_on).toBe("2026-10-28");
    expect(next.recurrence_count).toBe(2);
    expect(next.id).not.toBe(schedule.id);
  });
  it("enforces our shared five-size typography and spacing tokens",()=>{
    const layout=css.split(".training-plan-editor {")[1]?.split("}")[0]??"";
    expect(layout).toContain("gap: var(--space-compact-3)");
    const label=css.split(".training-plan-editor > .field > label {")[1]?.split("}")[0]??"";
    expect(label).toContain("font-size: var(--font-size-md)");
    expect(label).toContain("font-weight: var(--font-weight-medium)");
    const selector=css.split(".training-plan-editor > .field select {")[1]?.split("}")[0]??"";
    expect(selector).toContain("font-size: var(--font-size-sm)");
    expect(selector).toContain("min-height: var(--button-height-sm)");
    expect(selector).toContain("padding: var(--space-compact-3) var(--field-control-inline)");
  });
});
