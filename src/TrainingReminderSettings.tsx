import { useEffect, useState } from "react";
import { Field, Form, Select } from "./components";
import type { AuthSession } from "./backend";
import { getTrainingReminder, setTrainingReminder, type TrainingReminderTarget } from "./push-api";
import { reminderChoice, reminderOffsetMinutes, REMINDER_MULTIPLIER, type ReminderUnit } from "./reminder-choice";

export default function TrainingReminderSettings({
  session,
  petId,
  target,
}: {
  session: AuthSession;
  petId: string;
  target: TrainingReminderTarget;
}) {
  const [mode, setMode] = useState("none");
  const [amount, setAmount] = useState(1);
  const [unit, setUnit] = useState<ReminderUnit>("hours");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const targetId = target.sessionId ?? target.scheduleId;
  const isSchedule = !!target.scheduleId;
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError("");
    void getTrainingReminder(session, petId, target)
      .then((saved) => {
        if (!alive) return;
        const minutes = saved
          ? saved.offset_value * REMINDER_MULTIPLIER[saved.offset_unit] : 0;
        const choice = reminderChoice(minutes, saved?.enabled ?? false);
        setMode(choice.mode);
        setAmount(choice.amount);
        setUnit(choice.unit);
        setLoading(false);
      })
      .catch((cause) => {
        if (!alive) return;
        console.warn("[push] failed to load training reminder", cause);
        setError("Не удалось загрузить напоминание. Проверьте интернет и откройте карточку снова.");
      });
    return () => { alive = false; };
  }, [petId, session.user.id, targetId, isSchedule]);
  return (
    <div className="personal-reminder">
      <h3>Моё напоминание</h3>
      <p className="hint">
        {isSchedule
          ? "Для всех будущих занятий этого графика. Остановленный график не отправляет уведомления."
          : "Только для этой тренировки. После проведения, переноса или отмены время отправки пересчитывается."}
        {" "}У каждого участника своя настройка. Для доставки включите уведомления в разделе «Аккаунт».
      </p>
      {loading ? (
        <p className="hint" role={error ? "alert" : "status"}>
          {error || "Загружаем напоминание…"}
        </p>
      ) : (
        <Form label="Сохранить моё напоминание"
          onSave={async () => {
            setError("");
            setMessage("");
            try {
              const minutes = reminderOffsetMinutes(mode, amount, unit);
              await setTrainingReminder(session, petId, target, minutes, mode !== "none");
              setMessage("Напоминание о тренировке сохранено.");
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : "Не удалось сохранить напоминание.");
              throw cause;
            }
          }}
        >
          <Select label="Напомнить" value={mode}
            onChange={(event) => setMode(event.target.value)}>
            <option value="none">Не напоминать</option>
            <option value="0">В момент тренировки</option>
            <option value="10">За 10 минут</option>
            <option value="30">За 30 минут</option>
            <option value="60">За 1 час</option>
            <option value="1440">За 1 день</option>
            <option value="custom">Настроить</option>
          </Select>
          {mode === "custom" && (
            <div className="fields">
              <Field label="За сколько" type="number" min={1}
                max={unit === "minutes" ? 525600 : unit === "hours" ? 8760 : unit === "days" ? 365 : 52}
                value={amount}
                onChange={(event) => setAmount(Number(event.target.value) || 1)}
              />
              <Select label="Единицы" value={unit}
                onChange={(event) => setUnit(event.target.value as ReminderUnit)}>
                <option value="minutes">Минут</option>
                <option value="hours">Часов</option>
                <option value="days">Дней</option>
                <option value="weeks">Недель</option>
              </Select>
            </div>
          )}
        </Form>
      )}
      {message && <p role="status" className="hint">{message}</p>}
      {error && !loading && <p role="alert" className="notice notice-error">{error}</p>}
    </div>
  );
}
