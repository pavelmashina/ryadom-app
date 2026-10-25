import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { initialState, stateSchema, blankPet } from "./domain";
import { occursOn } from "./recurrence";
const file=(p:string)=>readFileSync(new URL(p,import.meta.url),"utf8");
const app=file("./App.tsx");
const css=file("./styles.css");
const cloud=file("./cloud-data.ts");
const planner=file("./TrainingPlan.tsx");
const trainingHistory=file("./TrainingHistory.tsx");
const scheduleMigration=file("../supabase/migrations/20261023152514_training_unbounded_month_materialization.sql");
const truncationMigration=file("../supabase/migrations/20261023154000_preserve_planned_when_truncating_schedule.sql");

describe("Infinite recurrence and new account state",()=>{
  it("supports events and reminders without a finite end date years ahead",()=>{
    expect(occursOn({date:"2026-10-23",repeat:"weekly",repeatWeekdays:[5],
      repeatEndType:"never",end:""}, "2050-10-21")).toBe(true);
    expect(occursOn({date:"2026-10-23",repeat:"weekly",repeatWeekdays:[5],
      repeatEndType:"never",end:""}, "2050-10-22")).toBe(false);
    expect(planner).toContain('ends_on: recurrence.endType === "date" ? recurrence.endDate : null');
    expect(file("./EventForm.tsx")).toContain('end: recurrence.frequency !== "once" && recurrence.endType === "date"');
  });
  it("materializes any visible month with authenticated access and without a 90-day cutoff",()=>{
    expect(scheduleMigration).toContain("CREATE OR REPLACE FUNCTION public.materialize_training_month");
    expect(scheduleMigration).toContain("pet_private.member_role(p_pet)");
    expect(scheduleMigration).toContain("date_trunc('month',p_month)");
    expect(scheduleMigration).toContain("grant execute on function public.materialize_training_month(uuid,date) to authenticated");
    expect(scheduleMigration).not.toContain("current_date+90");
    expect(app).toContain('rpc(session,"materialize_training_month"');
    expect(trainingHistory).toContain("onMonthVisible(month)");
  });
  it("preserves earlier planned sessions while truncating the recurrence after a cancelled day",()=>{
    expect(truncationMigration).toContain("previous_sc public.training_schedules");
    expect(truncationMigration).toContain("Only truncate this schedule: keep all earlier planned instances and IDs");
    expect(truncationMigration).toContain("and date>(sc->>'ends_on')::date");
    expect(file("./TrainingHistory.tsx")).toContain('s.status !== "cancelled"');
  });
  it("starts with zero pets and does not create a placeholder on first login",()=>{
    const empty=initialState();
    expect(empty).toEqual({version:1,selectedPet:"",pets:[]});
    expect(stateSchema.parse(empty)).toEqual(empty);
    expect(stateSchema.safeParse({...empty,selectedPet:"random"}).success).toBe(false);
    const pet=blankPet("Масюша");
    expect(stateSchema.parse({version:1,selectedPet:pet.id,pets:[pet]}).pets).toHaveLength(1);
    expect(cloud).not.toContain("return saveAccount(session, initialState())");
  });
  it("uses a compact header picker and moves profile and sharing management to Account",()=>{
    expect(app).toContain('className="pet-switcher-menu"');
    expect(app).toContain('role="menuitemradio"');
    expect(app).toContain('{screen !== "account" && screen !== "profile" && <header className="app-header">');
    expect(app).toContain('<Plus aria-hidden="true"/><span>Добавить питомца</span>');
    expect(app).toContain('SectionHeader title="Питомцы и доступ"');
    expect(app).toContain('goToPetSettings(p)');
    expect(css).toContain(".pet-switcher-menu {");
    expect(css).toContain(".account-pets-management");
  });
});
