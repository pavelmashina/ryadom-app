import { useEffect, useState } from "react";
import { Field, Form, Select } from "./components";
import type { AuthSession } from "./backend";
import { getSharedEventReminder, setSharedEventReminder } from "./push-api";
import { savedReminderChoice, reminderOffsetMinutes, type ReminderUnit } from "./reminder-choice";

export default function ReminderSettings({
  session,
  petId,
  eventId,
}: {
  session: AuthSession;
  petId: string;
  eventId: string;
}) {
  const [mode, setMode] = useState("none");
  const [amount, setAmount] = useState(2);
  const [unit, setUnit] = useState<ReminderUnit>("hours");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    void getSharedEventReminder(session, eventId)
      .then((rows) => {
        if (!alive) return;
        const choice = savedReminderChoice(rows);
        setMode(choice.mode);
        setAmount(choice.amount);
        setUnit(choice.unit);
      })
      .catch((e) => { if (alive) setError(e instanceof Error ? e.message : "Ошибка загрузки"); });
    return () => { alive = false; };
  }, [eventId, session.user.id]);

  return (
    <div className="personal-reminder">
      <h3>Настройка напоминания</h3>
      <p className="hint">
        Уведомление получат все участники питомца с разрешённым типом: «Событие» — «О событиях», «Напоминание» и предупреждения о запасах — «Напоминания».
      </p>
      <Form
        label="Сохранить напоминание"
        onSave={async () => {
          setError(""); setMessage("");
          try {
            const minutes = reminderOffsetMinutes(mode, amount, unit);
            await setSharedEventReminder(session, petId, eventId, minutes, mode !== "none");
            setMessage("Напоминание сохранено.");
          } catch (e) {
            const note = e instanceof Error ? e.message : "Ошибка сохранения";
            setError(note);
            throw e;
          }
        }}
      >
        <Select
          label="Напомнить"
          value={mode}
          onChange={(e) => setMode(e.target.value)}
        >
          <option value="none">Не напоминать</option>
          <option value="0">В момент события</option>
          <option value="10">За 10 минут</option>
          <option value="30">За 30 минут</option>
          <option value="60">За 1 час</option>
          <option value="1440">За 1 день</option>
          <option value="custom">Настроить</option>
        </Select>
        {mode === "custom" && (
          <div className="fields">
            <Field
              label="За сколько"
              type="number"
              min={1}
              max={unit === "minutes" ? 525600 : unit === "hours" ? 8760 : unit === "days" ? 365 : 52}
              value={amount}
              onChange={(e) => setAmount(Number(e.target.value) || 1)}
            />
            <Select label="Единицы" value={unit} onChange={(e) => setUnit(e.target.value as ReminderUnit)}>
              <option value="minutes">Минут</option>
              <option value="hours">Часов</option>
              <option value="days">Дней</option>
              <option value="weeks">Недель</option>
            </Select>
          </div>
        )}
      </Form>
      {message && <p role="status" className="hint">{message}</p>}
      {error && <p role="alert" className="notice notice-error">{error}</p>}
    </div>
  );
}
