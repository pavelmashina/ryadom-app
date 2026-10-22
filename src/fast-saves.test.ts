import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { blankPet, initialState, stateSchema } from "./domain";
import { sharedChanges } from "./cloud-data";
import { scheduleSchema, trainingTimestamp } from "./training-planning";
import { trainingSchema } from "./training-domain";

const source = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const saveMigration = source("../supabase/migrations/20261016124500_fast_training_saves.sql");

describe("Fast cloud saves", () => {
  it("does not rewrite training/command/schedule tables when changing only pet info", () => {
    const before = initialState();
    const next = structuredClone(before);
    next.pets[0].breed = "Спаниель";
    const changes = sharedChanges(next, before);
    expect(changes.changes).toHaveLength(1);
    expect(changes.changes[0]).toMatchObject({
      updateWorkouts: false, updateCommands: false, updateSchedules: false,
    });
  });
  it("reconciles sessions only for edited workouts", () => {
    const before = initialState();
    const next = structuredClone(before);
    next.pets[0].workouts = [{
      id: crypto.randomUUID(), status: "planned", date: "2026-10-17",
      scheduled_at: trainingTimestamp("2026-10-17", "13:30"),
      name: "Занятие", time: "13:30", duration_minutes: null,
      comment: "", created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(), results: [],
    }];
    const payload = sharedChanges(next, before).changes[0];
    expect(payload).toMatchObject({
      updateWorkouts: true, updateCommands: false, updateSchedules: false,
    });
    expect(stateSchema.safeParse(next).success).toBe(true);
  });
  it("sends schedule-only changes without rewriting 100+ session results", () => {
    const before = initialState();
    const next = structuredClone(before);
    next.pets[0].trainingSchedules = [{
      id: crypto.randomUUID(), name: "Дрессировка",
      time_of_day: "13:30", repeat_type: "weekdays", weekdays: [1,3,5],
      starts_on: "2026-10-19", ends_on: null,
      recurrence_frequency: "weekly", recurrence_interval: 1,
      recurrence_end_type: "never", recurrence_count: null,
      recurrence_monthday: null, is_active: true, comment: "",
      command_ids: [],
    }];
    expect(scheduleSchema.safeParse(next.pets[0].trainingSchedules[0]).success).toBe(true);
    expect(sharedChanges(next, before).changes[0]).toMatchObject({
      updateWorkouts: false, updateCommands: false, updateSchedules: true,
    });
    expect(stateSchema.safeParse(next).success).toBe(true);
  });
  it("retains legacy full reconciliation for old clients", () => {
    expect(saveMigration).toContain("coalesce((item->>''updateWorkouts'')::boolean,true)");
    expect(saveMigration).toContain("coalesce((item->>''updateCommands'')::boolean,true)");
    expect(saveMigration).toContain("coalesce((item->>''updateSchedules'')::boolean,true)");
  });
  it("skips whole-state loads when revision tag is unchanged", () => {
    const cloud = source("./cloud-data.ts");
    const app = source("./App.tsx");
    expect(cloud).toContain('rpc(session, "shared_state_tag", {})');
    expect(cloud).toContain("currentTag === previous.tag");
    expect(app).toContain("setInterval(refresh, 30000)");
  });
});
describe("Planning regressions", () => {
  it("interprets local clock date/time in the calendar server timezone", () => {
    expect(trainingTimestamp("2026-10-17", "13:30")).toBe("2026-10-17T10:30:00.000Z");
    expect(trainingTimestamp("2026-10-17", "")).toBe("2026-10-17T09:00:00.000Z");
  });
  it("accepts a planned session without evaluated commands", () => {
    const p = blankPet("Пёс");
    const session = {
      id: crypto.randomUUID(), status: "planned", date: "2026-10-17",
      scheduled_at: trainingTimestamp("2026-10-17", "13:30"),
      name: "Тренировка", time: "13:30", duration_minutes: null,
      comment: "", created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(), results: [],
    };
    expect(trainingSchema.safeParse(session).success).toBe(true);
    expect(stateSchema.safeParse({
      version: 1, selectedPet: p.id, pets: [{ ...p, workouts: [session] }],
    }).success).toBe(true);
  });
  it("checks plans locally before attempting network saves", () => {
    const plan = source("./TrainingPlan.tsx");
    expect(plan).toContain("scheduleSchema.safeParse(next)");
    expect(plan).toContain("trainingSchema.safeParse(next)");
    expect(plan).toContain('const name = get("name") || "Тренировка"');
  });
});
