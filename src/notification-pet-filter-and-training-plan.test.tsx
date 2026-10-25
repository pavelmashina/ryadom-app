import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import TrainingPlan from "./TrainingPlan";
import NotificationPreferencesSettings from "./NotificationPreferencesSettings";
import { blankPet } from "./domain";
import type { AuthSession } from "./backend";

const read=(path:string)=>readFileSync(new URL(path,import.meta.url),"utf8");
const session:AuthSession={
  user:{id:"test-user",email:"example@example.test"},
  accessToken:"token",refreshToken:"refresh",expiresAt:9999999999999,
};

describe("Training plan reminders and per-pet notification preferences",()=>{
  it("offers the established presets for scheduled and recurring workouts",()=>{
    const html=renderToStaticMarkup(<TrainingPlan pet={blankPet("Пёс")} onSave={async()=>{}} />);
    expect(html).toContain('>Напомнить</label>');
    expect(html).toContain('value="0">В момент тренировки');
    expect(html).toContain('value="10">За 10 минут');
    expect(html).toContain('value="30">За 30 минут');
    expect(html).toContain('value="60">За 1 час');
    expect(html).toContain('value="1440">За 1 день');
    expect(html).toContain('value="custom">Настроить');
    const code=read("./TrainingPlan.tsx");
    expect(code).toContain('setTrainingReminder(auth, pet.id, {scheduleId: valid.data.id}');
    expect(code).toContain('setTrainingReminder(auth, pet.id, {sessionId: valid.data.id}');
    expect(code).toContain('getTrainingReminder(auth, pet.id');
    expect(code).toContain('reminderOffsetMinutes(reminderMode, reminderAmount, reminderUnit)');
    expect(code).toContain('onComplete?.()');
  });
  it("omits details' reminder editor and the global training time picker",()=>{
    const app=read("./App.tsx"),preferences=read("./NotificationPreferencesSettings.tsx");
    const detail=app.split('case "detail": {')[1]?.split('case "pets":')[0]??"";
    expect(detail).not.toContain("<ReminderSettings");
    expect(app).toContain('onTrainingComplete={close}');
    expect(preferences).not.toContain("Напомнить о тренировке");
    expect(preferences).not.toContain("notification-training-offset");
    expect(read("./push-api.ts")).toContain("training_offset_minutes: 60");
  });
  it("provides a category-specific pet picker including All and any subset",()=>{
    const pets=[{id:"00000000-0000-4000-8000-000000000001",name:"Мася"},
      {id:"00000000-0000-4000-8000-000000000002",name:"Тёма"}];
    const html=renderToStaticMarkup(
      <NotificationPreferencesSettings session={session} pets={pets} />,
    );
    for(const label of ["О тренировках","О событиях","Напоминания"])expect(html).toContain(label);
    const src=read("./NotificationPreferencesSettings.tsx");
    for(const kind of ["trainings_pet_ids","events_pet_ids","reminders_pet_ids"])expect(src).toContain(kind);
    expect(src).toContain("Все питомцы");
    expect(src).toContain("pets.map(p=><label");
    expect(src).toContain("notification-pet-filter");
    expect(read("./Account.tsx")).toContain("pets={pets}");
    expect(read("./CloudGate.tsx")).toContain("accountContent={(pets) =>");
  });
  it("persists selection and server filters at enqueue and claim",()=>{
    const api=read("./push-api.ts");
    expect(api).toContain("trainings_pet_ids,events_pet_ids,reminders_pet_ids");
    expect(api).toContain('Array.isArray(ids)');
    expect(api).toContain('source: "personal"');
    const sql=read("../supabase/migrations/20261025181600_notification_pet_filters.sql");
    for(const key of ["trainings_pet_ids","events_pet_ids","reminders_pet_ids"])expect(sql).toContain(key);
    for(const kind of ["enqueue_due_push","claim_due_push","enqueue_due_stock_push",
      "claim_due_stock_push","enqueue_due_training_push","claim_due_training_push"])expect(sql).toContain("public."+kind);
    expect((sql.match(/pet_private.notification_pet_allowed/g)||[]).length).toBeGreaterThan(8);
  });
});
