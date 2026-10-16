import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { blankPet, initialState, petSchema, stateSchema } from "./domain";
import { needsFirstPetSetup } from "./first-pet-setup";
import FirstPetSetup from "./FirstPetSetup";
import Health from "./Health";
import {
  saveWeight, deleteWeight, saveMedicalRecord, deleteMedicalRecord, deletePetDocument,
} from "./health-actions";
import { reschedulePlannedTraining } from "./training-actions";
import TrainingHistory from "./TrainingHistory";

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("R2: first visit onboarding", () => {
  it("only prompts for an untouched placeholder, not existing user data", () => {
    const state = initialState();
    expect(needsFirstPetSetup(state)).toBe(true);
    state.pets[0].name = "Тузик";
    expect(needsFirstPetSetup(state)).toBe(false);
    state.pets[0].name = "Мой питомец";
    state.pets[0].weights.push({ id: crypto.randomUUID(), date: "2026-10-10", value: 5 });
    expect(needsFirstPetSetup(state)).toBe(false);
  });
  it("permanently honors skip, preserves existing backup compatibility", () => {
    const pet = blankPet("Мой питомец");
    const state = { version: 1 as const, selectedPet: pet.id, pets: [pet] };
    pet.onboardingCompleted = true;
    expect(needsFirstPetSetup(state)).toBe(false);
    expect(stateSchema.parse(state).pets[0].onboardingCompleted).toBe(true);
    const { onboardingCompleted: ignored, ...oldPet } = pet;
    expect(petSchema.parse(oldPet).onboardingCompleted).toBeUndefined();
    void ignored;
  });
  it("renders name first and offers optional profile info and skip", () => {
    const html = renderToStaticMarkup(<FirstPetSetup onSave={async () => {}} onSkip={async () => {}} />);
    expect(html).toContain("Имя питомца");
    expect(html).toContain("Дата рождения");
    expect(html).toContain("Заполнить позже");
    expect(source("./App.tsx")).toContain("finishFirstPetSetup(details)");
  });
});

describe("R2: correcting health history and deleting documents", () => {
  it("updates weight by ID instead of duplicating it", () => {
    const pet = blankPet("Бублик"), entry = { id: crypto.randomUUID(), date: "2026-10-10", value: 8 };
    const created = saveWeight(pet, entry);
    const updated = saveWeight(created, { ...entry, value: 8.5 });
    expect(updated.weights).toEqual([{ ...entry, value: 8.5 }]);
    expect(created.weights).toHaveLength(1);
    expect(deleteWeight(updated, entry.id).weights).toHaveLength(0);
    expect(() => deleteWeight(updated, crypto.randomUUID())).toThrow();
  });
  it("retains events but removes dangling links to a deleted medical record", () => {
    const pet = blankPet("Бублик"), recId = crypto.randomUUID();
    const entry = { id: recId, name: "Осмотр", type: "Визит" as const, date: "2026-10-10", note: "Норма" };
    const created = saveMedicalRecord(pet, entry);
    const updated = saveMedicalRecord(created, { ...entry, note: "Уточнённое назначение" });
    expect(updated.records).toHaveLength(1);
    expect(updated.records[0].note).toBe("Уточнённое назначение");
    updated.events = [{
      id: crypto.randomUUID(), name: "Контроль", category: "health",
      date: "2026-10-20", time: "12:00", repeat: "once",
      end: "", reminder: "0", note: "", linkedRecord: recId,
    }];
    const removed = deleteMedicalRecord(updated, recId);
    expect(removed.records).toHaveLength(0);
    expect(removed.events).toHaveLength(1);
    expect(removed.events[0].linkedRecord).toBeUndefined();
  });
  it("deletes only the requested document", () => {
    const pet = blankPet("Бублик"), a = crypto.randomUUID(), b = crypto.randomUUID();
    const pdf = "data:application/pdf;base64,QUJD";
    pet.documents = [{ id: a, name: "A", filename: "a.pdf", data: pdf },
      { id: b, name: "B", filename: "b.pdf", data: pdf }];
    expect(deletePetDocument(pet, a).documents.map((d) => d.id)).toEqual([b]);
    expect(pet.documents).toHaveLength(2);
  });
  it("shows editing actions for stored records and weight values", () => {
    const pet = blankPet("Бублик");
    pet.weights = [{ id: crypto.randomUUID(), date: "2026-10-10", value: 8 }];
    pet.records = [{ id: crypto.randomUUID(), date: "2026-10-11",
      type: "Визит", name: "Врач", note: "" }];
    const html = renderToStaticMarkup(<Health pet={pet} onWeight={() => {}}
      onEditWeight={() => {}} onEditRecord={() => {}}
      onRecord={() => {}} onPlan={() => {}} onSummary={() => {}} />);
    expect(html).toContain("Изменить вес от");
    expect(html).toContain("Связать с новым событием");
    expect(html).toContain("Изменить");
    expect(source("./App.tsx")).toContain('kind: "deleteRecord"');
    expect(source("./App.tsx")).toContain('kind: "deleteDocument"');
  });
});

describe("R2: quick planned training actions", () => {
  const session = {
    id: "8acc29e4-cc3f-4f52-adb4-0ef2e3d362cd",
    date: "2026-10-16", status: "planned" as const,
    name: "Прогулка", time: "10:00",
    duration_minutes: null, scheduled_at: "2026-10-16T10:00:00Z",
    completed_at: null, comment: "Повторяем команды",
    created_at: "2026-10-15T00:00:00Z",
    updated_at: "2026-10-15T00:00:00Z",
    results: [],
  };
  it("changes date/time but preserves the session ID, comment and planned status", () => {
    const pet = blankPet("Бублик");
    pet.workouts = [session];
    const updated = reschedulePlannedTraining(pet, session.id, "2026-10-17", "14:30");
    expect(updated.workouts[0]).toMatchObject({
      id: session.id, date: "2026-10-17", time: "14:30",
      status: "planned", comment: "Повторяем команды",
    });
    expect(updated.workouts[0].scheduled_at).toBeTruthy();
    expect(pet.workouts[0].date).toBe("2026-10-16");
  });
  it("rejects invalid dates, completed workouts and recurring instances", () => {
    const pet = blankPet("Бублик");
    pet.workouts = [session];
    expect(() => reschedulePlannedTraining(pet, session.id, "2026-02-30", "14:00")).toThrow();
    pet.workouts[0] = { ...session, status: "completed" };
    expect(() => reschedulePlannedTraining(pet, session.id, "2026-10-17", "14:00")).toThrow();
    pet.workouts[0] = { ...session, schedule_id: crypto.randomUUID() };
    expect(() => reschedulePlannedTraining(pet, session.id, "2026-10-17", "14:00")).toThrow(/графиком/);
  });
  it("has a direct action in training history", () => {
    const pet = blankPet("Бублик");pet.workouts = [session];
    const html = renderToStaticMarkup(<TrainingHistory
      sessions={pet.workouts} commands={[]} onOpen={() => {}} onEdit={() => {}}
      onReschedule={() => {}} />);
    expect(html).toContain("Перенести");
    expect(source("./Training.tsx")).toContain('view.kind === "reschedule"');
  });
});
describe("R2: saving status", () => {
  it("shows saving before a server response and keeps the edit dialog on errors", () => {
    expect(source("./App.tsx")).toContain('setNotice("Сохраняем в облаке…")');
    expect(source("./App.tsx")).toContain('aria-live="polite" aria-atomic="true"');
    expect(source("./components.tsx")).toContain('setError(e instanceof Error ? e.message : "Не удалось сохранить")');
  });
});
