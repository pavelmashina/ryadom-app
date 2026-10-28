import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Pencil, Plus } from "lucide-react";
import { Button, Card, Empty, IconButton, SectionHeader } from "./components";
import { fmt, today, type Pet } from "./domain";
import type { TrainingSession } from "./training-domain";
import { monthDays, shiftMonth, sessionsOnDate } from "./training-calendar";
export default function TrainingHistory({
  sessions,
  commands,
  onOpen,
  onEdit,
  onStart,
  onAdd,
  initialDate,
  onMonthVisible,
  petId,
  readOnly = false,
}: {
  readOnly?: boolean;
  sessions: TrainingSession[];
  commands: Pet["commands"];
  onOpen: (id: string) => void;
  onEdit: (session: TrainingSession) => void;
  onStart?: (session: TrainingSession) => void;
  onAdd?: () => void;
  initialDate?: string;
  onMonthVisible?: (month: string) => Promise<void>;
  petId?: string;
}) {
  // Each fresh calendar visit starts on the current day, not the latest session.
  const [selection, setSelection] = useState<string | null>(initialDate ?? null);
  const selected = selection ?? today();
  const [shownMonth, setMonth] = useState<string | null>(null);
  const month = shownMonth ?? selected.slice(0, 7);
  const requestedMonths = useRef(new Set<string>());
  useEffect(() => {
    if(!onMonthVisible || !petId) return;
    const key=petId+":"+month;
    if(requestedMonths.current.has(key))return;
    requestedMonths.current.add(key);
    void onMonthVisible(month).catch(error=>{
      requestedMonths.current.delete(key);
      console.warn("[PET APP] Cannot materialize visible training month",error);
    });
    // Only request when the pet or visible month changes.
  },[petId,month]);
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
  function chooseToday() {
    const day = today();
    setMonth(day.slice(0, 7));
    setSelection(day);
  }
  return (
    <section className="training-history" aria-label="История тренировок">
      <SectionHeader title={list ? "История тренировок" : "Календарь"}>
        {!list && onAdd && <Button size="sm" variant="primary" className="training-calendar-add"
          onClick={onAdd} aria-label="Добавить или запланировать тренировку"
          disabled={readOnly}><Plus aria-hidden="true" /></Button>}
      </SectionHeader>
      {!list && (
        <div className="training-calendar">
          <div className="month training-month">
            <h3 aria-live="polite">
              {fmt(month + "-01", { month: "long", year: "numeric" }).replace(" г.", "")}
            </h3>
            <div className="month-controls training-month-controls">
              <Button size="sm" variant="secondary" onClick={chooseToday}>
                Сегодня
              </Button>
              <IconButton label="Предыдущий месяц" onClick={() => changeMonth(-1)}>
                <ChevronLeft aria-hidden="true" />
              </IconButton>
              <IconButton label="Следующий месяц" onClick={() => changeMonth(1)}>
                <ChevronRight aria-hidden="true" />
              </IconButton>
            </div>
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
          <div className="legend calendar-key" aria-label="Обозначения календаря">
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
          className={"training-session-summary " + (s.status ?? "completed") +
            (s.status === "planned" && s.date === today() ? " today-planned" : "")}
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
          {s.status === "planned" && s.date === today() && !readOnly && (
            <div className="training-start-actions">
              <Button fullWidth variant="primary" onClick={() => onStart?.(s)}>
                Начать тренировку
              </Button>
            </div>
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
