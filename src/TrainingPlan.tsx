import { useState } from "react";
import { Form, Field, Select, Textarea, Checkbox } from "./components";
import { id, today, type Pet } from "./domain";
import { trainingTimestamp, type TrainingSchedule } from "./training-planning";
import type { TrainingSession } from "./training-domain";
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
  const [repeat, setRepeat] = useState(schedule?.repeat_type ?? "once");
  const [days, setDays] = useState<number[]>(schedule?.weekdays ?? []);
  const [commands, setCommands] = useState(
    schedule?.command_ids ?? session?.results.map((r) => r.command_id) ?? [],
  );
  return (
    <Form
      onSave={async (d) => {
        const get = (k: string) => String(d.get(k) ?? "").trim(),
          day = get("date"),
          time = get("time"),
          name = get("name"),
          comment = get("comment");
        if (repeat === "weekdays" && !days.length)
          throw Error("Выберите дни недели");
        if (get("end") && get("end") < day)
          throw Error("Конец графика раньше начала");
        if (repeat !== "once") {
          const next: TrainingSchedule = {
            id: schedule?.id ?? id(),
            name,
            time_of_day: time || null,
            repeat_type: repeat as TrainingSchedule["repeat_type"],
            weekdays: days,
            starts_on: day,
            ends_on: get("end") || null,
            is_active: true,
            comment,
            command_ids: commands,
          };
          await onSave({
            ...pet,
            trainingSchedules: [
              ...(pet.trainingSchedules ?? []).filter((x) => x.id !== next.id),
              next,
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
            results: commands.map((command_id) => ({
              command_id,
              performance_score: null,
              mode: "repeat",
              comment: "",
            })),
          };
          await onSave({
            ...pet,
            workouts: [...pet.workouts.filter((s) => s.id !== next.id), next],
          });
        }
      }}
    >
      <Field
        label="Дата"
        name="date"
        type="date"
        required
        defaultValue={
          schedule?.starts_on ?? session?.date ?? initialDate ?? today()
        }
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
        <Select
          label="Повторение"
          value={repeat}
          onChange={(e) => setRepeat(e.target.value)}
        >
          <option value="once" disabled={!!schedule}>
            Однократно
          </option>
          <option value="daily">Каждый день</option>
          <option value="weekly">Каждую неделю</option>
          <option value="weekdays">По дням недели</option>
        </Select>
      )}
      {repeat === "weekdays" && (
        <div>
          {["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"].map((day, i) => (
            <Checkbox
              key={day}
              label={day}
              checked={days.includes(i + 1)}
              onChange={() =>
                setDays((ds) =>
                  ds.includes(i + 1)
                    ? ds.filter((d) => d !== i + 1)
                    : [...ds, i + 1],
                )
              }
            />
          ))}
        </div>
      )}
      {repeat !== "once" && (
        <>
          <Field
            label="Повторять до · необязательно"
            name="end"
            type="date"
            defaultValue={schedule?.ends_on ?? ""}
          />
          <p className="hint">
            Тренировки создаются на 90 дней вперёд. Проведённые занятия
            сохраняются при изменении графика.
          </p>
        </>
      )}
      <h3>Запланированные команды</h3>
      {pet.commands
        .filter((c) => !c.archived || commands.includes(c.id))
        .map((c) => (
          <Checkbox
            key={c.id}
            label={c.name}
            checked={commands.includes(c.id)}
            onChange={() =>
              setCommands((cs) =>
                cs.includes(c.id)
                  ? cs.filter((id) => id !== c.id)
                  : [...cs, c.id],
              )
            }
          />
        ))}
    </Form>
  );
}
