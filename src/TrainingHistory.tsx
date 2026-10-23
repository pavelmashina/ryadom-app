import { useState } from "react";
import { ChevronLeft, ChevronRight, Pencil } from "lucide-react";
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
    sessions
      .filter((s) => (s.status ?? "completed") === "completed")
      .reduce((d, s) => (s.date > d ? s.date : d), "") ||
    sessions
      .filter((s) => s.status === "planned")
      .reduce((d, s) => (s.date > d ? s.date : d), "") ||
    today();
  const [selection, setSelection] = useState<string | null>(null);
  const selected = selection ?? latest;
  const [shownMonth, setMonth] = useState<string | null>(null);
  const month = shownMonth ?? selected.slice(0, 7);
  const [list, setList] = useState(false);
  const [limit, setLimit] = useState(10);
  const counts = new Map<string, number>();
  const dayMarkers = new Map<string, { completed: boolean; planned: boolean }>();
  sessions
    .filter((s) => s.status !== "cancelled")
    .forEach((s) => {
      counts.set(s.date, (counts.get(s.date) ?? 0) + 1);
      const markers = dayMarkers.get(s.date) ?? { completed: false, planned: false };
      if (s.status === "planned") markers.planned = true;
      else markers.completed = true;
      dayMarkers.set(s.date, markers);
    });
  const ordered = sessions
    .filter((s) => s.status !== "cancelled")
    .sort(
      (a, b) =>
        b.date.localeCompare(a.date) ||
        b.created_at.localeCompare(a.created_at) ||
        b.id.localeCompare(a.id),
    );
  const shown = list
    ? ordered
        .filter((s) => (s.status ?? "completed") === "completed")
        .slice(0, limit)
    : sessionsOnDate(ordered, selected);
  function changeMonth(delta: number) {
    const next = shiftMonth(month, delta);
    setMonth(next);
    setSelection(next + "-01");
  }
  return (
    <section className="training-history" aria-label="История тренировок">
      <SectionHeader title={list ? "История тренировок" : "Календарь"} />
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
              {fmt(month + "-01", { month: "long", year: "numeric" }).replace(" г.", "")}
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
            {monthDays(month).map((day, i) => {
              if (!day) return <span key={"blank" + i} />;
              const markers = dayMarkers.get(day);
              return (
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
                  <span className="training-day-number">{Number(day.slice(-2))}</span>
                  <span
                    className={"training-day-markers" +
                      (markers?.completed && markers.planned ? " both" : "")}
                    aria-hidden="true"
                  >
                    {markers?.completed && <span className="training-day-dot" />}
                    {markers?.planned && <span className="training-day-planned" />}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="calendar-key" aria-label="Обозначения календаря">
            <span className="training-legend-item">
              <span className="training-legend-dot" aria-hidden="true" />
              Проведено
            </span>
            <span className="training-legend-item">
              <span className="training-legend-dot planned" aria-hidden="true" />
              Запланировано
            </span>
          </div>
        </div>
      )}
      {!list && (
        <h3 className="training-selected-date" aria-live="polite">
          {fmt(selected, { day: "numeric", month: "long" })}
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
        <Card
          key={s.id}
          className={"training-session-summary " + (s.status ?? "completed")}
        >
          <div className="training-session-heading">
            <div className="training-session-title-row">
              <strong>{s.name?.trim() || "Тренировка"}</strong>
              {s.status === "planned" && (
                <button type="button" className="training-inline-edit"
                  aria-label="Редактировать тренировку"
                  title="Редактировать тренировку"
                  disabled={readOnly}
                  onClick={() => onEdit(s)}>
                  <Pencil aria-hidden="true" />
                </button>
              )}
            </div>
            <span className="training-session-meta">
              {list && (
                <span className="training-session-date">
                  {fmt(s.date, { day: "numeric", month: "long", year: "numeric" })}
                </span>
              )}
              <span>{s.status === "planned" ? "Запланирована" : "Проведена"}</span>
              {s.time && <span> · {s.time}</span>}
              {s.duration_minutes && <span> · {s.duration_minutes} мин</span>}
              {!!s.results.length && <span> · {s.results.length} команд</span>}
            </span>
          </div>
          <div className={"training-result-chips app-horizontal-scroll" + (s.results.length === 1 ? " single" : "")}>
            {s.results.map((r) => (
              <span key={r.command_id}
                className={"training-result-chip " + (
                  r.performance_score === 5 ? "quality-excellent"
                  : r.performance_score !== null && r.performance_score >= 3 ? "quality-developing"
                  : r.performance_score !== null ? "quality-needs-work" : "quality-unrated"
                )}>
                <span>
                  {commands.find((c) => c.id === r.command_id)?.name ??
                    "Команда"}
                </span>
                <b>
                  {r.performance_score === null
                    ? "План"
                    : r.performance_score + "/5"}
                </b>
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
          {s.status !== "planned" && <div className="training-session-actions">
            <Button size="sm" variant="ghost" onClick={() => onOpen(s.id)}>
              Подробнее
            </Button>
            <Button size="sm" variant="ghost" disabled={readOnly} onClick={() => onEdit(s)}>
              Редактировать
            </Button>
          </div>}
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
