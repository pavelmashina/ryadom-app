import { useState } from "react";
import { eventSchema, id, type PetEvent } from "./domain";
import { Field, Select, Note, Form, text } from "./components";
import { categories } from "./Calendar";
export default function EventForm({
  selected,
  category = "care",
  name = "",
  linkedRecord,
  onSave,
}: {
  selected: string;
  category?: PetEvent["category"];
  name?: string;
  linkedRecord?: string;
  onSave: (e: PetEvent) => void;
}) {
  const [allDay, setAllDay] = useState(true),
    [repeat, setRepeat] = useState("once");
  return (
    <Form
      label="Добавить в календарь"
      onSave={(d) => {
        const parsed = eventSchema.safeParse({
          id: id(),
          name: text(d, "name"),
          category: text(d, "category"),
          date: text(d, "date"),
          time: allDay ? "" : text(d, "time"),
          repeat,
          end: repeat === "once" ? "" : text(d, "end"),
          reminder: text(d, "reminder"),
          note: text(d, "note"),
          linkedRecord,
        });
        if (!parsed.success) throw new Error(parsed.error.issues[0].message);
        onSave(parsed.data);
      }}
    >
      <Select label="Категория" name="category" defaultValue={category}>
        {Object.entries(categories).map(([k, v]) => (
          <option key={k} value={k}>
            {v}
          </option>
        ))}
      </Select>
      <Field
        label="Что запланируем?"
        name="name"
        defaultValue={name}
        required
        maxLength={120}
      />
      <div className="fields">
        <Field
          label="Дата"
          type="date"
          name="date"
          defaultValue={selected}
          required
        />
        <Field
          label="Время"
          type="time"
          name="time"
          defaultValue="09:00"
          disabled={allDay}
          required={!allDay}
        />
      </div>
      <label className="checkline">
        <input
          type="checkbox"
          checked={allDay}
          onChange={(e) => setAllDay(e.target.checked)}
        />
        Весь день
      </label>
      <Select
        label="Повторять"
        value={repeat}
        onChange={(e) => setRepeat(e.target.value)}
      >
        <option value="once">Не повторять</option>
        <option value="daily">Каждый день</option>
        <option value="weekly">Каждую неделю</option>
      </Select>
      {repeat !== "once" && (
        <Field
          label="Последний день повторения · необязательно"
          type="date"
          name="end"
        />
      )}
      <Select label="Настройка напоминания" name="reminder" defaultValue="0">
        <option value="0">Без напоминания</option>
        <option value="15">За 15 минут</option>
        <option value="60">За 1 час</option>
        <option value="1440">За 1 день</option>
      </Select>
      <p className="hint">
        Настройка сохраняется. Отправка уведомлений в этой версии ещё не
        подключена.
      </p>
      <Note />
    </Form>
  );
}
