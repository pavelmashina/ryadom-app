import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import Calendar from "./Calendar";
import { blankPet } from "./domain";
import { trainingSchema } from "./training-domain";
import { reminderChoice, reminderOffsetMinutes, savedReminderChoice } from "./reminder-choice";

const source = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const eventId = "8acc29e4-cc3f-4f52-adb4-0ef2e3d362cd";

describe("Release 1: cross-screen training journey", () => {
  it("renders a plan and a completed workout in the main calendar", () => {
    const pet = blankPet("Тест");
    pet.workouts = [
      { id: eventId, status: "planned", date: "2026-10-16",
        name: "Тренировка в зале", time: "10:00", duration_minutes: null,
        scheduled_at: "2026-10-16T10:00:00Z", completed_at: null,
        comment: "", created_at: "2026-10-16T00:00:00Z",
        updated_at: "2026-10-16T00:00:00Z", results: [] },
      { id: "aacc29e4-cc3f-4f52-adb4-0ef2e3d362cd", status: "completed", date: "2026-10-16",
        name: "Команды", time: "12:00", duration_minutes: null,
        scheduled_at: null, completed_at: "2026-10-16T12:00:00Z",
        comment: "", created_at: "2026-10-16T00:00:00Z",
        updated_at: "2026-10-16T00:00:00Z",
        results: [{ command_id: "sit", performance_score: 5, mode: "repeat", comment: "" }] },
    ];
    // The callbacks are wired from App; rendering the calendar must not depend
    // on a route or user state to show a workout row.
    const html = renderToStaticMarkup(
      <Calendar pet={pet} selected="2026-10-16" month="2026-10-01"
        setSelected={() => {}} setMonth={() => {}}
        onAdd={() => {}} onTraining={() => {}} onToggle={() => {}}
        onDetail={() => {}} />,
    );
    expect(html).toContain("Тренировка в зале");
    expect(html).toContain("Запланирована");
    expect(html).toContain("Проведена");
    expect(source("./App.tsx")).toContain("onTraining={(id) => {");
    expect(source("./App.tsx")).toContain('setOpenTraining(id);');
    expect(source("./App.tsx")).toContain('setScreen("training");');
    expect(source("./Training.tsx")).toContain('setView({ kind: "session", id: openSession })');
  });
});
describe("Release 1: explicitly chosen training scores", () => {
  it("initializes newly chosen commands without an evaluation", () => {
    expect(source("./Training.tsx")).not.toContain("performance_score: 3");
    expect(source("./Training.tsx")).toContain("performance_score: null");
  });
  it("refuses completion until each command has a score", () => {
    const session = { id: eventId, date: "2026-10-16", status: "completed",
      duration_minutes: null, comment: "", created_at: "2026-10-16T00:00:00Z",
      updated_at: "2026-10-16T00:00:00Z", results: [
        { command_id: "sit", performance_score: null, mode: "repeat", comment: "" },
      ] };
    expect(trainingSchema.safeParse(session).success).toBe(false);
    expect(trainingSchema.safeParse({ ...session,
      results: [{ ...session.results[0], performance_score: 3 }] }).success).toBe(true);
  });
  it("does not reactivate a paused recurring schedule on editing", () => {
    expect(source("./TrainingPlan.tsx")).toContain("is_active: schedule?.is_active ?? true");
  });
});
describe("Release 1: personal reminder consistency", () => {
  it("uses the same presets and custom durations in both interfaces", () => {
    expect(reminderChoice(60, true).mode).toBe("60");
    expect(reminderChoice(0, true).mode).toBe("0");
    expect(reminderChoice(0, false).mode).toBe("none");
    expect(reminderChoice(20160, true)).toEqual({ mode: "custom", amount: 2, unit: "weeks" });
    expect(reminderOffsetMinutes("custom", 2, "weeks")).toBe(20160);
    expect(reminderOffsetMinutes("none", 99, "hours")).toBe(0);
    expect(() => reminderOffsetMinutes("custom", 53, "weeks")).toThrow();
  });
  it("prefers only the current user's active server reminder", () => {
    expect(savedReminderChoice([]).mode).toBe("none");
    expect(savedReminderChoice([{ id: "x", user_id: "u", event_id: eventId,
      enabled: true, offset_value: 2, offset_unit: "hours" }]))
      .toEqual({ mode: "custom", amount: 2, unit: "hours" });
    expect(savedReminderChoice([{ id: "x", user_id: "u", event_id: eventId,
      enabled: false, offset_value: 2, offset_unit: "hours" }]).mode).toBe("none");
  });
  it("loads the personal reminder before event edits and syncs the final ID", () => {
    const event = source("./EventForm.tsx");
    const app = source("./App.tsx");
    expect(event).toContain("getPersonalReminders(session, existing.id)");
    expect(event).toContain('if (!reminderReady) throw new Error');
    expect(app).toContain('const targetId = e.repeat !== "once" && scope !== "all" ? id() : e.id;');
    expect(app).toContain("await syncPersonalReminder(targetId, next)");
    expect(app).toContain("setPersonalReminder(session, pet.id, eventId, Number(event.reminder), !!event.reminderEnabled)");
    expect(event).not.toContain("Отправка push-уведомлений будет подключена отдельно");
  });
});
