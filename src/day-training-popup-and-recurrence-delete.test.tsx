import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { trainingScheduleText } from "./training-detail";
import { formatEventDetailDate } from "./event-detail-date";
import { cancelPlannedTraining } from "./training-actions";
import { blankPet } from "./domain";
import type { TrainingSchedule } from "./training-planning";
import type { TrainingSession } from "./training-domain";

const read=(p:string)=>readFileSync(new URL(p,import.meta.url),"utf8");
const app=read("./App.tsx");
const calendar=read("./Calendar.tsx");
const modal=app.split('case "trainingDetail": {')[1]?.split('case "modifyTraining": {')[0]??"";
const deletion=app.split('case "modifyTraining": {')[1]?.split('case "detail": {')[0]??"";

function schedule(): TrainingSchedule {
  return {
    id:"11111111-1111-4111-8111-111111111111", name:"Тренировка",
    time_of_day:"20:00", repeat_type:"weekdays",
    recurrence_frequency:"weekly",recurrence_interval:1,
    recurrence_end_type:"date",recurrence_count:null,
    recurrence_monthday:null,weekdays:[1,3],starts_on:"2026-10-19",
    ends_on:"2026-12-30",is_active:true,comment:"С собой лакомства",command_ids:[],
  };
}
function workout(id:string, on:string, scheduleId:string | null):TrainingSession {
  return {
    id,date:on,time:"20:00",name:"Тренировка",schedule_id:scheduleId,
    status:"planned",scheduled_at:"2026-10-26T17:00:00.000Z",
    completed_at:null,duration_minutes:null,comment:"",
    created_at:"2026-10-19T00:00:00.000Z",
    updated_at:"2026-10-19T00:00:00.000Z",results:[],
  };
}

describe("Day screen: workout uses event-style details",()=>{
  it("opens a modal while staying on Day and preserving the date",()=>{
    const handler=app.split('onTraining={(id) => {')[1]?.split('}}')[0]??"";
    expect(handler).toContain('setOverlay({ kind: "trainingDetail", sessionId: id })');
    expect(handler).not.toContain('setScreen("training")');
    expect(handler).not.toContain("window.scrollTo");
    expect(handler).not.toContain("setSelected");
    expect(app).toContain('kind: "trainingDetail"; sessionId: string');
    expect(calendar).toContain('onClick={() => onTraining(w.id)}');
    expect(app).toContain('function close() {');
    expect(app).toContain("setOverlay(null)");
  });
  it("uses the same clock, date, recurrence and optional note as events",()=>{
    expect(modal).toContain('className="event-detail-modal training-day-detail"');
    expect(modal).toContain('className="event-detail-summary"');
    expect(modal).toContain('<Clock aria-hidden="true" />');
    expect(modal).toContain('formatEventDetailDate(workout.date, time)');
    expect(modal).toContain("Тренировка · {trainingScheduleText(schedule)}");
    expect(modal).toContain('{comment.trim() && <p className="note">{comment}</p>}');
    expect(formatEventDetailDate("2026-10-25","20:00","2026-10-25")).toBe("Сегодня, 20:00");
    expect(trainingScheduleText()).toBe("Однократно");
    expect(trainingScheduleText(schedule())).toContain("Каждую неделю");
    expect(trainingScheduleText(schedule())).toContain("до 2026-12-30");
    expect(trainingScheduleText(schedule())).toContain("пн, ср");
  });
  it("shows Edit/Delete and reschedule for one-offs but never 'Mark complete' on Day",()=>{
    expect(modal).toContain('className="fields event-detail-actions"');
    expect(modal).toContain('className="event-detail-delete"');
    expect(modal).toContain("Изменить");
    expect(modal).toContain("Удалить");
    expect(modal).toContain("Перенести");
    expect(modal).toContain('workout.status === "planned" && !schedule');
    expect(modal).not.toContain("Отметить выполненным");
    expect(modal).not.toContain("Отметить проведённой");
    expect(modal).not.toContain("toggle(workout");
    expect(modal).toContain('reschedulePlannedTraining(');
  });
  it("allows deletion of one or all following sessions, but not completed training",()=>{
    expect(deletion).toContain('schedule && <Select label="Удалить"');
    expect(deletion).toContain('<option value="one">Только эту тренировку</option>');
    expect(deletion).toContain('<option value="following">Эту и все последующие</option>');
    expect(app).toContain("cancelPlannedTraining(p, workout.id, scope)");
    expect(deletion).toContain('workout.status !== "planned"');
    const sc=schedule();
    const p=blankPet("Пёс");
    p.trainingSchedules=[sc];
    p.workouts=[
      workout("22222222-2222-4222-8222-222222222222","2026-10-26",sc.id),
      workout("33333333-3333-4333-8333-333333333333","2026-10-28",sc.id),
      workout("44444444-4444-4444-8444-444444444444","2026-11-02",sc.id),
    ];
    const single=cancelPlannedTraining(p,p.workouts[0].id,"one");
    expect(single.workouts.map(w=>w.status)).toEqual(["cancelled","planned","planned"]);
    const following=cancelPlannedTraining(p,p.workouts[0].id,"following");
    expect(following.workouts.map(w=>w.status)).toEqual(["cancelled","cancelled","cancelled"]);
    expect(following.trainingSchedules?.[0]?.ends_on).toBe("2026-10-25");
  });
  it("prompts with two scopes for recurring events and reminders as well",()=>{
    const edit=app.split('case "modifyEvent": {')[1]?.split('case "trainingDetail": {')[0]??"";
    expect(edit).toContain('<option value="single">Только это событие</option>');
    expect(edit).toContain('<option value="future">Это и последующие</option>');
    expect(edit).toContain('{overlay.action === "edit" && <option value="all">');
    expect(edit).toContain("deleteEvent(current, overlay.on, scope)");
  });
});
