import { Field, Select, Note, Form, text, Checkbox } from "./components";
import TrainingPlan from "./TrainingPlan";
import RecurrenceFields, { draftForDate, type RecurrenceDraft } from "./RecurrenceFields";
import type { Pet } from "./domain";
import { useState } from "react";
import { eventSchema, id, type PetEvent } from "./domain";
import { categories } from "./Calendar";

export default function EventForm({
  selected,
  category = "care",
  name = "",
  linkedRecord,
  onSave,
  pet,
  onTrainingSave,
  existing,
}: {
  selected: string;
  pet?: Pet;
  onTrainingSave?: (pet: Pet) => Promise<void>;
  category?: PetEvent["category"];
  name?: string;
  linkedRecord?: string;
  existing?: PetEvent;
  onSave: (e: PetEvent) => void | Promise<void>;
}) {
  const initialDate = existing?.date ?? selected;
  const [chosen, setChosen] = useState(existing?.category ?? category);
  const [kind, setKind] = useState<"event" | "reminder">(existing?.kind ?? "event");
  const [startDate, setStartDate] = useState(initialDate);
  const [allDay, setAllDay] = useState(!existing?.time);
  const [recurrence, setRecurrence] = useState<RecurrenceDraft>(() => ({
    ...draftForDate(initialDate),
    frequency: existing?.repeat ?? "once",
    interval: existing?.repeatInterval ?? 1,
    weekdays: existing?.repeatWeekdays ??
      [new Date(initialDate + "T12:00:00").getDay() || 7],
    monthday: existing?.repeatMonthday ?? Number(initialDate.slice(-2)),
    endType: existing?.repeatEndType ?? (existing?.end ? "date" : "never"),
    endDate: existing?.end ?? "",
    count: existing?.repeatCount ?? 10,
  }));
  const initialReminder = !existing?.reminder || (existing.reminder === "0" && !existing.reminderEnabled)
    ? "none"
    : existing.reminder === "0" ? "now"
    : ["10", "30", "60", "1440"].includes(existing.reminder) ? existing.reminder
    : "custom";
  const [reminderMode, setReminderMode] = useState(initialReminder);
  const oldOffset = Number(existing?.reminder ?? "0");
  const oldUnit = oldOffset >= 10080 && oldOffset % 10080 === 0 ? "weeks"
    : oldOffset >= 1440 && oldOffset % 1440 === 0 ? "days"
    : oldOffset >= 60 && oldOffset % 60 === 0 ? "hours" : "minutes";
  const minuteMultipliers: Record<string, number> = {
    minutes: 1, hours: 60, days: 1440, weeks: 10080,
  };
  const [customUnit, setCustomUnit] = useState(initialReminder === "custom" ? oldUnit : "days");
  const [customAmount, setCustomAmount] = useState(
    initialReminder === "custom" ? oldOffset / minuteMultipliers[oldUnit] : 3,
  );
  if (chosen === "training" && pet && onTrainingSave && !existing)
    return (
      <>
        <Select
          label="Категория"
          value={chosen}
          onChange={(e) => setChosen(e.target.value as typeof chosen)}
        >
          {Object.entries(categories).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </Select>
        <TrainingPlan
          pet={pet}
          initialDate={selected}
          onSave={onTrainingSave}
        />
      </>
    );
  return (
    <Form
      label={existing ? "Сохранить изменения" : "Добавить в календарь"}
      onSave={async (d) => {
        if (recurrence.frequency === "weekly" && recurrence.weekdays.length === 0)
          throw new Error("Выберите хотя бы один день недели");
        if (recurrence.endType === "date" &&
            (!recurrence.endDate || recurrence.endDate < startDate))
          throw new Error("Дата окончания должна быть не раньше начала");

        const minutes = reminderMode === "none" || reminderMode === "now" ? 0
          : reminderMode === "custom"
            ? customAmount * minuteMultipliers[customUnit]
            : Number(reminderMode);
        const parsed = eventSchema.safeParse({
          ...existing,
          id: existing?.id ?? id(),
          name: text(d, "name"),
          category: text(d, "category"),
          kind,
          date: text(d, "date"),
          time: allDay ? "" : text(d, "time"),
          repeat: recurrence.frequency,
          repeatInterval: recurrence.frequency === "once" ? undefined : recurrence.interval,
          repeatWeekdays: recurrence.frequency === "weekly" ? recurrence.weekdays : undefined,
          repeatMonthday: recurrence.frequency === "monthly" ? recurrence.monthday : undefined,
          repeatEndType: recurrence.frequency === "once" ? undefined : recurrence.endType,
          repeatCount: recurrence.endType === "count" && recurrence.frequency !== "once"
            ? recurrence.count : undefined,
          end: recurrence.frequency !== "once" && recurrence.endType === "date"
            ? recurrence.endDate : "",
          reminder: String(minutes),
          reminderEnabled: reminderMode !== "none",
          note: text(d, "note"),
          linkedRecord: existing?.linkedRecord ?? linkedRecord,
        });
        if (!parsed.success) throw new Error(parsed.error.issues[0].message);
        await onSave(parsed.data);
      }}
    >
      <Select
        label="Категория"
        name="category"
        value={chosen}
        onChange={(e) => setChosen(e.target.value as typeof chosen)}
      >
        {Object.entries(categories).map(([k, v]) => (
          <option key={k} value={k}>{v}</option>
        ))}
      </Select>
      <Select
        label="Тип"
        value={kind}
        onChange={(e) => setKind(e.target.value as "event" | "reminder")}
      >
        <option value="event">Событие</option>
        <option value="reminder">Напоминание</option>
      </Select>
      <Field
        label="Что запланируем?"
        name="name"
        defaultValue={existing?.name ?? name}
        required
        maxLength={120}
      />
      <div className="fields">
        <Field
          label="Дата"
          type="date"
          name="date"
          defaultValue={initialDate}
          onChange={(e) => {
            const next = e.target.value;
            setStartDate(next);
            if (next) setRecurrence((r) => ({
              ...r,
              monthday: Number(next.slice(-2)),
              weekdays: [new Date(next + "T12:00:00").getDay() || 7],
            }));
          }}
          required
        />
        <Field
          label="Время"
          type="time"
          name="time"
          defaultValue={existing?.time || "09:00"}
          disabled={allDay}
          required={!allDay}
        />
      </div>
      <Checkbox
        label="Весь день"
        checked={allDay}
        onChange={(e) => setAllDay(e.target.checked)}
      />
      <RecurrenceFields date={startDate} value={recurrence} onChange={setRecurrence} />
      <Select
        label="Напомнить"
        value={reminderMode}
        onChange={(e) => setReminderMode(e.target.value)}
      >
        <option value="none">Не напоминать</option>
        <option value="now">В момент события</option>
        <option value="10">За 10 минут</option>
        <option value="30">За 30 минут</option>
        <option value="60">За 1 час</option>
        <option value="1440">За 1 день</option>
        <option value="custom">Настроить</option>
      </Select>
      {reminderMode === "custom" && (
        <div className="fields">
          <Field
            label="За сколько"
            type="number"
            min={1}
            max={customUnit === "minutes" ? 525600 : customUnit === "hours" ? 8760 : customUnit === "days" ? 365 : 52}
            value={customAmount}
            onChange={(e) => setCustomAmount(Number(e.target.value) || 1)}
          />
          <Select label="Единицы" value={customUnit} onChange={(e) => setCustomUnit(e.target.value)}>
            <option value="minutes">Минут</option>
            <option value="hours">Часов</option>
            <option value="days">Дней</option>
            <option value="weeks">Недель</option>
          </Select>
        </div>
      )}
      <p className="hint">
        Время напоминания сохраняется. Отправка push-уведомлений будет подключена отдельно.
      </p>
      <Note label="Комментарий" value={existing?.note ?? ""} />
    </Form>
  );
}
