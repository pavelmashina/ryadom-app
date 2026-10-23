import { useState } from "react";
import { Form, Field, Textarea } from "./components";
import RecurrenceFields, { draftForDate, type RecurrenceDraft } from "./RecurrenceFields";
import TrainingDateField from "./TrainingDateField";
import { id, today, type Pet } from "./domain";
import { trainingTimestamp, scheduleSchema, type TrainingSchedule } from "./training-planning";
import { trainingSchema, type TrainingSession } from "./training-domain";

export default function TrainingPlan({
  pet,
  session,
  schedule,
  onSave,
  initialDate,
}: {
  pet: Pet;
  initialDate?: string;
  session?: TrainingSession;
  schedule?: TrainingSchedule;
  onSave: (pet: Pet) => Promise<void>;
}) {
  const initial = schedule?.starts_on ?? session?.date ?? initialDate ?? today();
  const [startDate, setStartDate] = useState(initial);
  const [recurrence, setRecurrence] = useState<RecurrenceDraft>(() => ({
    ...draftForDate(initial),
    frequency:
      schedule?.recurrence_frequency ??
      (schedule?.repeat_type === "weekdays" ? "weekly" : schedule?.repeat_type ?? "once"),
    interval: schedule?.recurrence_interval ?? 1,
    weekdays: schedule?.weekdays?.length ? schedule.weekdays
      : [new Date(initial + "T12:00:00").getDay() || 7],
    monthday: schedule?.recurrence_monthday ?? Number(initial.slice(-2)),
    endType: schedule?.recurrence_end_type ??
      (schedule?.ends_on ? "date" : "never"),
    endDate: schedule?.ends_on ?? "",
    count: schedule?.recurrence_count ?? 10,
  }));
  return (
    <Form
      label={schedule || session ? "Сохранить изменения" : "Запланировать"}
      onSave={async (d) => {
        const get = (k: string) => String(d.get(k) ?? "").trim();
        const day = get("date");
        const time = get("time");
        const name = get("name") || "Тренировка";
        const comment = get("comment");
        if (recurrence.frequency === "weekly" && recurrence.weekdays.length === 0)
          throw Error("Выберите хотя бы один день недели");
        if (recurrence.frequency !== "once" && recurrence.endType === "date" &&
            (!recurrence.endDate || recurrence.endDate < day))
          throw Error("Конец графика раньше начала");
        if (recurrence.frequency !== "once") {
          const next: TrainingSchedule = {
            id: schedule?.id ?? id(),
            name,
            time_of_day: time || null,
            // Keep the legacy repeat_type compatible with existing clients.
            repeat_type: recurrence.frequency === "weekly" ? "weekdays" : "daily",
            weekdays: recurrence.frequency === "weekly" ? recurrence.weekdays : [],
            starts_on: day,
            ends_on: recurrence.endType === "date" ? recurrence.endDate : null,
            recurrence_frequency: recurrence.frequency,
            recurrence_interval: recurrence.interval,
            recurrence_end_type: recurrence.endType,
            recurrence_count: recurrence.endType === "count" ? recurrence.count : null,
            recurrence_monthday: recurrence.frequency === "monthly"
              ? recurrence.monthday : null,
            is_active: schedule?.is_active ?? true,
            comment,
            command_ids: schedule?.command_ids ?? [],
          };
          const valid = scheduleSchema.safeParse(next);
          if (!valid.success)
            throw new Error("Проверьте график: " + valid.error.issues[0]?.message);
          await onSave({
            ...pet,
            trainingSchedules: [
              ...(pet.trainingSchedules ?? []).filter((x) => x.id !== next.id),
              valid.data,
            ],
          });
        } else {
          const next: TrainingSession = {
            ...session,
            id: session?.id ?? id(),
            date: day,
            time,
            name,
            comment,
            status: "planned",
            scheduled_at: trainingTimestamp(day, time),
            completed_at: null,
            duration_minutes: null,
            created_at: session?.created_at ?? new Date().toISOString(),
            updated_at: new Date().toISOString(),
            results: session?.results ?? [],
          };
          const valid = trainingSchema.safeParse(next);
          if (!valid.success)
            throw new Error("Проверьте тренировку: " + valid.error.issues[0]?.message);
          await onSave({
            ...pet,
            workouts: [...pet.workouts.filter((s) => s.id !== next.id), valid.data],
          });
        }
      }}
    >
      <TrainingDateField
        label="Дата"
        name="date"
        required
        value={startDate}
        onChange={(e) => {
          const day = e.target.value;
          setStartDate(day);
          if (day) setRecurrence((x) => ({
            ...x,
            weekdays: [new Date(day + "T12:00:00").getDay() || 7],
            monthday: Number(day.slice(-2)),
          }));
        }}
      />
      <Field
        label="Время · необязательно"
        name="time"
        type="time"
        defaultValue={schedule?.time_of_day?.slice(0, 5) ?? session?.time ?? ""}
      />
      <Field
        label="Название · необязательно"
        name="name"
        maxLength={120}
        defaultValue={schedule?.name ?? session?.name ?? ""}
      />
      <Textarea
        label="Комментарий"
        name="comment"
        maxLength={5000}
        defaultValue={schedule?.comment ?? session?.comment ?? ""}
      />
      {!session && (
        <RecurrenceFields date={startDate} value={recurrence} onChange={setRecurrence} flatEnd />
      )}
      {recurrence.frequency !== "once" && !session && (
        <p className="hint">
          Плановые занятия формируются на ближайшие 90 дней. Проведённые занятия
          и оценки сохраняются при изменении графика.
        </p>
      )}
    </Form>
  );
}
