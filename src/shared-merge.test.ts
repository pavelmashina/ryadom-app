import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { blankPet, initialState, stateSchema, type Pet, type State } from "./domain";
import { sharedChanges } from "./cloud-data";
import { mergeSharedState, sameData, SharedEditConflict } from "./shared-merge";

function states(): [State, State, State] {
  const base = initialState();
  return [base, structuredClone(base), structuredClone(base)];
}
const weight = (id: string, value: number) => ({
  id, date: "2026-10-16", value,
});
const workout = (id: string, comment: string) => ({
  id, date: "2026-10-16", status: "planned" as const,
  scheduled_at: "2026-10-16T15:00:00.000Z", duration_minutes: null,
  completed_at: null, time: "18:00", name: "Тренировка",
  comment, created_at: "2026-10-16T09:00:00Z",
  updated_at: "2026-10-16T09:00:00Z", results: [],
});
const schedule = (id: string) => ({
  id, name: "График", time_of_day: "18:00",
  repeat_type: "weekdays" as const, weekdays: [1, 3, 5],
  starts_on: "2026-10-19", ends_on: null,
  recurrence_frequency: "weekly" as const, recurrence_interval: 1,
  recurrence_end_type: "never" as const, recurrence_count: null,
  recurrence_monthday: null, is_active: true, comment: "",
  command_ids: [],
});

describe("Structural equality for cloud snapshots", () => {
  it("does not resubmit records when Postgres reorders object keys", () => {
    const [base, local] = states();
    const wid = crypto.randomUUID();
    const record = workout(wid, "Без изменений");
    base.pets[0].workouts = [record];
    const reversed = Object.fromEntries(Object.entries(record).reverse()) as typeof record;
    local.pets[0].workouts = [reversed];
    expect(sameData(record, reversed)).toBe(true);
    expect(sharedChanges(local, base).changes).toHaveLength(0);
  });
  it("detects real nested differences even with different object key order", () => {
    expect(sameData({ a: { x: 1 }, b: 2 }, { b: 2, a: { x: 2 } })).toBe(false);
    expect(sameData([1, 2], [2, 1])).toBe(false);
  });
});

describe("R4: safe three-way reconciliation for shared pets", () => {
  it("keeps another user's workout when this user records weight", () => {
    const [base, local, remote] = states();
    local.pets[0].weights.push(weight(crypto.randomUUID(), 6));
    remote.pets[0].workouts.push(workout(crypto.randomUUID(), "Другая тренировка"));
    remote.pets[0].revision = 8;
    const merged = mergeSharedState(base, local, remote);
    expect(merged.pets[0].weights).toHaveLength(1);
    expect(merged.pets[0].workouts).toHaveLength(1);
    expect(merged.pets[0].revision).toBe(8);
    expect(sharedChanges(merged, remote).changes[0]).toMatchObject({
      revision: 8, updateWorkouts: false,
      updateCommands: false, updateSchedules: false,
    });
    expect(base.pets[0].weights).toHaveLength(0);
    expect(remote.pets[0].weights).toHaveLength(0);
  });

  it("reconciles two newly added workouts and retains server ordering", () => {
    const [base, local, remote] = states();
    const localId = crypto.randomUUID();
    const remoteId = crypto.randomUUID();
    local.pets[0].workouts = [workout(localId, "Локально")];
    remote.pets[0].workouts = [workout(remoteId, "С другого телефона")];
    const merged = mergeSharedState(base, local, remote);
    expect(merged.pets[0].workouts.map((x) => x.id)).toEqual([remoteId, localId]);
    expect(sharedChanges(merged, remote).changes[0].updateWorkouts).toBe(true);
  });

  it("merges separate fields without losing existing records", () => {
    const [base, local, remote] = states();
    const itemId = crypto.randomUUID();
    base.pets[0].records = [{
      id: itemId, name: "Осмотр", type: "Визит", date: "2026-10-16", note: "",
    }];
    local.pets[0].records = structuredClone(base.pets[0].records);
    remote.pets[0].records = structuredClone(base.pets[0].records);
    local.pets[0].records[0].note = "Назначение";
    remote.pets[0].records[0].name = "Контрольный осмотр";
    const merged = mergeSharedState(base, local, remote);
    expect(merged.pets[0].records[0]).toMatchObject({
      name: "Контрольный осмотр", note: "Назначение",
    });
  });

  it("rejects two different values for the same health record field", () => {
    const [base, local, remote] = states();
    const recordId = crypto.randomUUID();
    base.pets[0].weights = [weight(recordId, 6)];
    local.pets[0].weights = [weight(recordId, 7)];
    remote.pets[0].weights = [weight(recordId, 8)];
    expect(() => mergeSharedState(base, local, remote))
      .toThrow(SharedEditConflict);
    expect(local.pets[0].weights[0].value).toBe(7);
    expect(remote.pets[0].weights[0].value).toBe(8);
  });

  it("rejects deletion of a record edited by another participant", () => {
    const [base, local, remote] = states();
    const id = crypto.randomUUID();
    base.pets[0].workouts = [workout(id, "")];
    local.pets[0].workouts = [];
    remote.pets[0].workouts = [workout(id, "Updated elsewhere")];
    expect(() => mergeSharedState(base, local, remote))
      .toThrow(/не перезаписать/);
  });

  it("merges two independent schedule additions when old clients omitted the array", () => {
    const [base, local, remote] = states();
    const left = crypto.randomUUID(), right = crypto.randomUUID();
    local.pets[0].trainingSchedules = [schedule(left)];
    remote.pets[0].trainingSchedules = [schedule(right)];
    const merged = mergeSharedState(base, local, remote);
    expect(merged.pets[0].trainingSchedules?.map((x) => x.id)).toEqual([right, left]);
  });

  it("merges independent completion flags in the same calendar map", () => {
    const [base, local, remote] = states();
    local.pets[0].done["a:2026-10-17"] = true;
    remote.pets[0].done["b:2026-10-18"] = true;
    const merged = mergeSharedState(base, local, remote);
    expect(merged.pets[0].done).toEqual({
      "a:2026-10-17": true, "b:2026-10-18": true,
    });
  });

  it("rejects write against revoked/deleted pet instead of restoring access", () => {
    const [base, local, remote] = states();
    local.pets[0].breed = "Пудель";
    const id = base.pets[0].id;
    const other = blankPet("Другой питомец");
    for (const state of [base, local, remote]) state.pets.push(other);
    remote.pets = [other];
    remote.selectedPet = other.id;
    expect(() => mergeSharedState(base, local, remote))
      .toThrow(SharedEditConflict);
    expect(id).not.toBe(other.id);
  });

  it("keeps the current device's selected pet, and applies server revision and role", () => {
    const [base, local, remote] = states();
    const other = blankPet("Другой");
    for (const s of [base, local, remote]) s.pets.push(other);
    local.pets[0].ration = 170;
    remote.selectedPet = other.id;
    remote.pets[0].role = "editor";
    remote.pets[0].revision = 42;
    const merged = mergeSharedState(base, local, remote);
    expect(merged.selectedPet).toBe(local.selectedPet);
    expect(merged.pets[0]).toMatchObject({
      ration: 170, role: "editor", revision: 42,
    });
  });

  it("never posts combined state with a dangling training command reference", () => {
    const [base, local, remote] = states();
    const commandId = crypto.randomUUID();
    base.pets[0].commands = [{ id: commandId, name: "Сидеть" }];
    local.pets[0].commands = [];
    remote.pets[0].workouts = [{
      ...workout(crypto.randomUUID(), ""),
      results: [{ command_id: commandId, performance_score: null, mode: "learning", comment: "" }],
    }];
    remote.pets[0].commands = [{ id: commandId, name: "Сидеть" }];
    expect(() => mergeSharedState(base, local, remote))
      .toThrow(SharedEditConflict);
    expect(stateSchema.safeParse(remote).success).toBe(true);
  });

  it("does not mutate any of the three original snapshots", () => {
    const [base, local, remote] = states();
    local.pets[0].breed = "Спаниель";
    remote.pets[0].weights = [weight(crypto.randomUUID(), 4)];
    const copies = [base, local, remote].map((x) => JSON.stringify(x));
    mergeSharedState(base, local, remote);
    expect([base, local, remote].map((x) => JSON.stringify(x))).toEqual(copies);
  });
});

describe("R4: bounded, server-authorized retry and feedback", () => {
  const code = readFileSync(new URL("./CloudGate.tsx", import.meta.url), "utf8");
  const api = readFileSync(new URL("./backend.ts", import.meta.url), "utf8");
  const app = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
  it("only retries a true server revision conflict", () => {
    expect(api).toContain('body?.code === "PT409"');
    expect(api).toContain('body.message?.includes("Питомец изменён другим участником")');
    expect(code).toContain("cause instanceof RevisionConflictError");
  });
  it("fetches fresh server version and attempts one rebased save", () => {
    expect(code).toContain("const fresh = await loadAccount(s)");
    expect(code).toContain("mergeSharedState(before, next, fresh.state)");
    expect(code).toContain("saveAccount(s, rebased, fresh.state)");
    expect(code.match(/saveAccount\(s,/g)).toHaveLength(2);
  });
  it("reports conflict reconciliation to the person saving", () => {
    expect(app).toContain("stored.combined");
    expect(app).toContain("Изменения другого участника тоже сохранены");
    expect(app).toContain('setNotice("Сохраняем в облаке…")');
  });
});
