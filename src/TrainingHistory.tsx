import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button, Card, Empty, IconButton, SectionHeader } from "./components";
import { fmt, today, type Pet } from "./domain";
import type { TrainingSession } from "./training-domain";
import { monthDays, shiftMonth, sessionsOnDate } from "./training-calendar";
export default function TrainingHistory({
  sessions,
  commands,
  onOpen,
  onEdit,
  readOnly = false,
}: {
  readOnly?: boolean;
  sessions: TrainingSession[];
  commands: Pet["commands"];
  onOpen: (id: string) => void;
  onEdit: (session: TrainingSession) => void;
}) {
  const latest =
    sessions.reduce((d, s) => (s.date > d ? s.date : d), "") || today();
  const [selection, setSelection] = useState<string | null>(null);
  const selected = selection ?? latest;
  const [shownMonth, setMonth] = useState<string | null>(null);
  const month = shownMonth ?? selected.slice(0, 7);
  const [list, setList] = useState(false);
  const [limit, setLimit] = useState(10);
  const counts = new Map<string, number>();
  sessions.forEach((s) => counts.set(s.date, (counts.get(s.date) ?? 0) + 1));
  const ordered = [...sessions].sort(
    (a, b) =>
      b.date.localeCompare(a.date) ||
      b.created_at.localeCompare(a.created_at) ||
      b.id.localeCompare(a.id),
  );
  const shown = list
    ? ordered.slice(0, limit)
    : sessionsOnDate(ordered, selected);
  function changeMonth(delta: number) {
    const next = shiftMonth(month, delta);
    setMonth(next);
    setSelection(next + "-01");
  }
  return (
    <section className="training-history" aria-label="История тренировок">
      <SectionHeader title={list ? "Все занятия" : "Календарь занятий"}>
        <span>{sessions.length}</span>
      </SectionHeader>
      {!list && (
        <div className="training-calendar">
          <div className="training-month">
            <IconButton
              label="Предыдущий месяц"
              onClick={() => changeMonth(-1)}
            >
              <ChevronLeft aria-hidden="true" />
            </IconButton>
            <h3 aria-live="polite">
              {fmt(month + "-01", { month: "long", year: "numeric" })}
            </h3>
            <IconButton label="Следующий месяц" onClick={() => changeMonth(1)}>
              <ChevronRight aria-hidden="true" />
            </IconButton>
          </div>
          <div className="training-weekdays" aria-hidden="true">
            {["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"].map((d) => (
              <span key={d}>{d}</span>
            ))}
          </div>
          <div
            className="training-days"
            role="group"
            aria-label="Выберите день"
          >
            {monthDays(month).map((day, i) =>
              day ? (
                <button
                  type="button"
                  key={day}
                  className="training-day"
                  aria-pressed={day === selected}
                  aria-current={day === today() ? "date" : undefined}
                  aria-label={
                    fmt(day, {
                      day: "numeric",
                      month: "long",
                      year: "numeric",
                    }) +
                    ", тренировок: " +
                    (counts.get(day) ?? 0)
                  }
                  onClick={() => setSelection(day)}
                >
                  <span>{Number(day.slice(-2))}</span>
                  {counts.has(day) && (
                    <span className="training-day-dot" aria-hidden="true" />
                  )}
                </button>
              ) : (
                <span key={"blank" + i} />
              ),
            )}
          </div>
          <p className="calendar-key">
            <span aria-hidden="true" />
            Дни с тренировками
          </p>
        </div>
      )}
      {!list && (
        <h3 className="training-selected-date" aria-live="polite">
          {fmt(selected, { day: "numeric", month: "long", year: "numeric" })}
        </h3>
      )}
      {!shown.length && (
        <Empty
          title={list ? "Пока нет тренировок" : "В этот день тренировок нет"}
        >
          {list
            ? "Добавьте первое занятие."
            : "Выберите день с точкой или добавьте тренировку."}
        </Empty>
      )}
      {shown.map((s) => (
        <Card key={s.id} className="training-session-summary">
          <div className="training-session-heading">
            <strong>
              {fmt(s.date, { day: "numeric", month: "long", year: "numeric" })}
            </strong>
            <span>
              Команд: {s.results.length}
              {s.duration_minutes ? " · " + s.duration_minutes + " мин" : ""}
            </span>
          </div>
          <div className="training-result-chips">
            {s.results.map((r) => (
              <span key={r.command_id} className="training-result-chip">
                <span>
                  {commands.find((c) => c.id === r.command_id)?.name ??
                    "Команда"}
                </span>
                <b>{r.performance_score}/5</b>
              </span>
            ))}
          </div>
          {s.comment && (
            <details className="training-comment">
              <summary>
                <span className="training-excerpt">{s.comment}</span>
                <span className="comment-toggle">Комментарий целиком</span>
              </summary>
              <p className="note">{s.comment}</p>
            </details>
          )}
          <div className="training-session-actions">
            <Button size="sm" variant="ghost" onClick={() => onOpen(s.id)}>
              Подробнее
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={readOnly}
              onClick={() => onEdit(s)}
            >
              Редактировать
            </Button>
          </div>
        </Card>
      ))}
      {list && ordered.length > limit && (
        <Button
          fullWidth
          variant="ghost"
          onClick={() => setLimit((n) => n + 10)}
        >
          Показать ещё
        </Button>
      )}
      <Button fullWidth variant="secondary" onClick={() => setList((v) => !v)}>
        {list ? "Вернуться к календарю" : "Все занятия списком"}
      </Button>
    </section>
  );
}
