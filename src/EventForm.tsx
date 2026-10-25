import { Field, Select, Note, Form, text, Checkbox } from "./components";
import TrainingPlan from "./TrainingPlan";
import TrainingDateField from "./TrainingDateField";
import TrainingTimeField from "./TrainingTimeField";
import RecurrenceFields, { draftForDate, type RecurrenceDraft } from "./RecurrenceFields";
import type { Pet } from "./domain";
import { useEffect, useState } from "react";
import type { AuthSession } from "./backend";
import { getPersonalReminders } from "./push-api";
import { reminderChoice, savedReminderChoice, reminderOffsetMinutes, type ReminderUnit } from "./reminder-choice";
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
  session,
}: {
  selected: string;
  pet?: Pet;
  onTrainingSave?: (pet: Pet) => Promise<void>;
  category?: PetEvent["category"];
  name?: string;
  linkedRecord?: string;
  existing?: PetEvent;
  session?: AuthSession;
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
  const initialChoice = reminderChoice(Number(existing?.reminder || "0"), !!existing?.reminderEnabled);
  const [reminderMode, setReminderMode] = useState(initialChoice.mode);
  const [customUnit, setCustomUnit] = useState<ReminderUnit>(initialChoice.unit);
  const [customAmount, setCustomAmount] = useState(initialChoice.amount);
  const [reminderReady, setReminderReady] = useState(!existing || !session);
  const [reminderError, setReminderError] = useState("");
  useEffect(() => {
    if (!existing || !session) return;
    let alive = true;
    setReminderReady(false);
    setReminderError("");
    void getPersonalReminders(session, existing.id)
      .then((rows) => {
        if (!alive) return;
        const choice = savedReminderChoice(rows);
        setReminderMode(choice.mode);
        setCustomAmount(choice.amount);
        setCustomUnit(choice.unit);
        setReminderReady(true);
      })
      .catch((error) => {
        if (!alive) return;
        console.warn("[reminder] failed to load personal reminder for event edit", error);
        setReminderError("Не удалось загрузить личное напоминание. Проверьте соединение и откройте событие снова.");
      });
    return () => { alive = false; };
  }, [existing?.id, session?.user.id]);
  if (chosen === "training" && pet && onTrainingSave && !existing)
    return (
      <div className="event-editor-modal">
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
      </div>
    );
  return (
    <div className="event-editor-modal">
    <Form
      label={existing ? "Сохранить изменения" : "Добавить в календарь"}
      onSave={async (d) => {
        if (!reminderReady) throw new Error(reminderError || "Загружаем личное напоминание. Повторите сохранение.");
        if (recurrence.frequency === "weekly" && recurrence.weekdays.length === 0)
          throw new Error("Выберите хотя бы один день недели");
        if (recurrence.endType === "date" &&
            (!recurrence.endDate || recurrence.endDate < startDate))
          throw new Error("Дата окончания должна быть не раньше начала");

        const minutes = reminderOffsetMinutes(reminderMode, customAmount, customUnit);
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
      <TrainingDateField
        label="Дата"
        name="date"
        value={startDate}
        onChange={(e) => {
          const next = e.target.value;
          setStartDate(next);
          if (next) setRecurrence((r) => ({
            ...r,
            monthday: r.frequency === "monthly" ? r.monthday : Number(next.slice(-2)),
            weekdays: [new Date(next + "T12:00:00").getDay() || 7],
          }));
        }}
        required
      />
      <TrainingTimeField
        label="Время"
        name="time"
        defaultValue={existing?.time || "09:00"}
        disabled={allDay}
        required={!allDay}
      />
      <Checkbox
        label="Весь день"
        checked={allDay}
        onChange={(e) => setAllDay(e.target.checked)}
      />
      <div className="training-planner-recurrence">
        <RecurrenceFields date={startDate} value={recurrence} onChange={setRecurrence}
          flatEnd simpleFrequencyLabels monthlyDayPicker />
      </div>
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
          <Select label="Единицы" value={customUnit} onChange={(e) => setCustomUnit(e.target.value as ReminderUnit)}>
            <option value="minutes">Минут</option>
            <option value="hours">Часов</option>
            <option value="days">Дней</option>
            <option value="weeks">Недель</option>
          </Select>
        </div>
      )}
      {existing && !reminderReady && (
        <p className="hint" role="status">{reminderError || "Загружаем ваше личное напоминание…"}</p>
      )}
      <p className="hint">
        Напоминание сохраняется лично для вашего аккаунта. Для доставки push включите уведомления в разделе «Аккаунт».
      </p>
      <Note label="Комментарий" value={existing?.note ?? ""} />
    </Form>
    </div>
  );
}
