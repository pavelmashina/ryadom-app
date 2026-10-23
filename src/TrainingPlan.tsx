import { useState } from "react";
import { Form } from "./components";
import RecurrenceFields, { draftForDate, type RecurrenceDraft } from "./RecurrenceFields";
import TrainingDateField from "./TrainingDateField";
import TrainingTimeField from "./TrainingTimeField";
import { id, today, type Pet } from "./domain";
import { trainingTimestamp, scheduleSchema, type TrainingSchedule } from "./training-planning";
import { trainingSchema, type TrainingSession } from "./training-domain";

export function validatePlanningInterval(text: string, frequency: RecurrenceDraft["frequency"]): number {
  if (frequency === "once") return 1;
  const value = Number(text);
  if (!text.trim() || !Number.isInteger(value) || value < 1 || value > 366)
    throw new Error("Укажите периодичность от 1 до 366");
  return value;
}

export function validateMonthlyRepeatDay(frequency: RecurrenceDraft["frequency"], day: number): void {
  if(frequency === "monthly" && (!Number.isInteger(day) || day < 1 || day > 32))
    throw new Error("Выберите число месяца или отметьте «Последнее число месяца»");
}

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
  const initial = session?.date ?? schedule?.starts_on ?? initialDate ?? today();
  const [startDate, setStartDate] = useState(initial);
  const [intervalText, setIntervalText] = useState(String(schedule?.recurrence_interval ?? 1));
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
        const name = schedule?.name || session?.name || "Тренировка";
        const comment = schedule?.comment ?? session?.comment ?? "";
        const interval = validatePlanningInterval(intervalText, recurrence.frequency);
        validateMonthlyRepeatDay(recurrence.frequency, recurrence.monthday);
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
            recurrence_interval: interval,
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
            // Converting an individual planned session to a recurring schedule
            // must not leave the old one-off session on that date.
            workouts: session && !schedule
              ? pet.workouts.filter(x => x.id !== session.id)
              : pet.workouts,
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
            monthday: x.frequency === "monthly" ? x.monthday : Number(day.slice(-2)),
          }));
        }}
      />
      <TrainingTimeField
        label="Время · необязательно"
        name="time"
        defaultValue={schedule?.time_of_day?.slice(0, 5) ?? session?.time ?? ""}
      />
      <div className="training-planner-recurrence">
          <RecurrenceFields
            date={startDate}
            value={recurrence}
            onChange={setRecurrence}
            flatEnd
            allowedFrequencies={schedule
              ? ["daily","weekly","monthly","yearly"]
              : ["once","daily","weekly","monthly","yearly"]}
            simpleFrequencyLabels
            monthlyDayPicker
            intervalText={intervalText}
            onIntervalTextChange={setIntervalText}
          />
        </div>
    </Form>
  );
}
