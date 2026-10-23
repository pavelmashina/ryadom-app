import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import type { AuthSession } from "./backend";
import { reminderChoice, reminderOffsetMinutes, REMINDER_MULTIPLIER } from "./reminder-choice";
import TrainingReminderSettings from "./TrainingReminderSettings";
const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const migration = source("../supabase/migrations/20261016120500_training_push_reminders.sql");
const worker = source("../supabase/functions/pet-push-worker/index.ts");
const app = source("./App.tsx");
const training = source("./Training.tsx");
const push = source("./push-api.ts");
const fakeSession = { user: { id: "tester" }, accessToken: "test" } as AuthSession;
const sid = "8acc29e4-cc3f-4f52-adb4-0ef2e3d362cd";

describe("Training reminders: frontend", () => {
  it("shows personal settings for a single session and a recurring graph", () => {
    const single = renderToStaticMarkup(
      <TrainingReminderSettings session={fakeSession} petId={sid}
        target={{ sessionId: sid }} />,
    );
    const repeating = renderToStaticMarkup(
      <TrainingReminderSettings session={fakeSession} petId={sid}
        target={{ scheduleId: sid }} />,
    );
    expect(single).toContain("Только для этой тренировки");
    expect(repeating).toContain("Для всех будущих занятий");
    expect(single).toContain("Загружаем напоминание");
    // Recurring reminders remain accessible from the planned session details,
    // even though the separate "Регулярный график" block was removed.
    expect(training).toContain('setView(schedule');
    expect(training).toContain("<TrainingReminderSettings");
    expect(app).toContain("session={session}");
  });
  it("shares presets with the calendar reminder editor", () => {
    expect(reminderChoice(60, true).mode).toBe("60");
    expect(reminderChoice(0, true).mode).toBe("0");
    expect(reminderChoice(14400, true).unit).toBe("days");
    expect(reminderOffsetMinutes("custom", 3, "days")).toBe(4320);
    expect(REMINDER_MULTIPLIER.weeks).toBe(10080);
    expect(() => reminderOffsetMinutes("custom", 54, "weeks")).toThrow();
  });
  it("does not silently create a reminder when user chooses not to notify", () => {
    expect(push).toContain("} else if (enabled) {");
    expect(push).toContain("training_reminders?select=");
    expect(push).toContain('method: "PATCH"');
    expect(push).toContain('method: "POST"');
    expect(push).toContain("user_id: session.user.id");
  });
  it("deep-links notification to the specific workout and handles missing entries", () => {
    expect(worker).toContain('"/ryadom-app/?training="');
    expect(app).toContain('params.get("training")');
    expect(app).toContain("setOpenTraining(trainingId)");
    expect(app).toContain("matchingPet.id !== state.selectedPet");
    expect(app).toContain("Тренировка из уведомления больше недоступна");
  });
});
describe("Training reminders: database and worker regression guards", () => {
  it("keeps event reminders intact using distinct queue and device tables", () => {
    expect(migration).toContain("create table public.training_reminders");
    expect(migration).toContain("create table public.training_notification_deliveries");
    expect(migration).toContain("create table public.training_notification_device_deliveries");
    expect(worker).toContain('rpc("enqueue_due_push")');
    expect(worker).toContain('rpc("enqueue_due_training_push")');
    expect(worker).toContain('rpc("claim_due_push"');
    expect(worker).toContain('rpc("claim_due_training_push"');
    expect(worker).toContain('job.kind === "training"');
  });
  it("requires signed-in member and target pet equality for every reminder write", () => {
    expect(migration).toContain("alter table public.training_reminders enable row level security");
    expect(migration).toContain("user_id=(select auth.uid())");
    expect(migration).toContain("pet_private.member_role(pet_id) is not null");
    expect(migration).toContain("s.id=session_id and s.pet_id=pet_id");
    expect(migration).toContain("sc.id=schedule_id and sc.pet_id=pet_id");
    expect(migration).toContain("training_reminders_exactly_one_target");
    expect(migration).toContain("revoke all on public.training_notification_deliveries");
  });
  it("ensures idempotency across devices, sessions and recurring occurrences", () => {
    expect(migration).toContain("unique(user_id,reminder_id,session_id,occurrence_at)");
    expect(migration).toContain("primary key(delivery_id,subscription_id)");
    expect(migration).toContain("on conflict(user_id,reminder_id,session_id,occurrence_at) do nothing");
  });
  it("does not send for cancelled, completed, moved, paused or revoked training", () => {
    expect(migration).toContain("s.status='planned'");
    expect(migration).toContain("s.scheduled_at=d.occurrence_at");
    expect(migration).toContain("(s.schedule_id is null or sc.is_active)");
    expect(migration).toContain("m.status='active'");
    expect(migration).toContain("p.deleted_at is null");
    expect(migration).toContain("d.offset_minutes=r.offset_value *");
    expect(migration).toContain("r.enabled");
    expect(migration).toContain("for update of d skip locked");
  });
  it("prevents unauthenticated queue execution", () => {
    expect(migration).toContain("revoke all on function public.enqueue_due_training_push()");
    expect(migration).toContain("public.claim_due_training_push(integer) to service_role");
  });
});
