import { ChevronLeft, ChevronRight, Plus, CalendarDays } from "lucide-react";
import {
  date,
  iso,
  fmt,
  today,
  eventsFor,
  completionKey,
  type Pet,
  type PetEvent,
} from "./domain";
import { Empty } from "./components";
export const categories = {
  health: "Здоровье",
  training: "Занятия",
  care: "Уход",
};
export default function Calendar({
  pet,
  selected,
  month,
  setSelected,
  setMonth,
  onAdd,
  onToggle,
  onDetail,
}: {
  pet: Pet;
  selected: string;
  month: string;
  setSelected: (s: string) => void;
  setMonth: (s: string) => void;
  onAdd: () => void;
  onToggle: (e: PetEvent, s: string) => void;
  onDetail: (e: PetEvent, s: string) => void;
}) {
  const m = date(month),
    offset = (new Date(m.getFullYear(), m.getMonth(), 1).getDay() + 6) % 7,
    count = new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate();
  const cells = Array.from(
    { length: Math.ceil((count + offset) / 7) * 7 },
    (_, i) => iso(new Date(m.getFullYear(), m.getMonth(), 1 + i - offset)),
  );
  const events = eventsFor(pet, selected),
    done = events.filter((e) => pet.done[completionKey(e, selected)]),
    todo = events.filter((e) => !pet.done[completionKey(e, selected)]);
  const overdue = pet.events.filter(
    (e) =>
      e.repeat === "once" &&
      e.date < today() &&
      !pet.done[completionKey(e, e.date)],
  );
  function choose(s: string) {
    setSelected(s);
    setMonth(s.slice(0, 7) + "-01");
  }
  function task(e: PetEvent) {
    const checked = !!pet.done[completionKey(e, selected)];
    return (
      <div className={`task ${checked ? "done" : ""}`} key={e.id}>
        <span className={`tag ${e.category}`} />
        <input
          type="checkbox"
          checked={checked}
          onChange={() => onToggle(e, selected)}
          aria-label={`${checked ? "Снять отметку" : "Выполнить"}: ${e.name}`}
        />
        <button className="task-body" onClick={() => onDetail(e, selected)}>
          <strong>{e.name}</strong>
          <small>
            {e.time || "Весь день"} · {categories[e.category]}
            {e.repeat !== "once" ? " · повтор" : ""}
          </small>
        </button>
        <ChevronRight size={17} />
      </div>
    );
  }
  return (
    <>
      <div className="heading">
        <span className="eyebrow">Забота каждый день</span>
        <h1>Наши планы</h1>
        <p>Всё важное для {pet.name} — в одном месте</p>
      </div>
      <section className="calendar" aria-label="Календарь месяца">
        <div className="month">
          <h2>
            {fmt(month, { month: "long", year: "numeric" }).replace(" г.", "")}
          </h2>
          <div className="month-controls">
            <button className="pill" onClick={() => choose(today())}>
              Сегодня
            </button>
            <button
              className="icon"
              aria-label="Предыдущий месяц"
              onClick={() =>
                choose(iso(new Date(m.getFullYear(), m.getMonth() - 1, 1)))
              }
            >
              <ChevronLeft />
            </button>
            <button
              className="icon"
              aria-label="Следующий месяц"
              onClick={() =>
                choose(iso(new Date(m.getFullYear(), m.getMonth() + 1, 1)))
              }
            >
              <ChevronRight />
            </button>
          </div>
        </div>
        <div className="weekdays">
          {["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"].map((d) => (
            <span key={d}>{d}</span>
          ))}
        </div>
        <div className="dates">
          {cells.map((s) => {
            const ev = eventsFor(pet, s),
              cats = [...new Set(ev.map((e) => e.category))];
            return (
              <button
                key={s}
                className={`date ${s.slice(0, 7) !== month.slice(0, 7) ? "outside" : ""} ${s === today() ? "today" : ""}`}
                aria-pressed={s === selected}
                aria-label={`${fmt(s, { day: "numeric", month: "long", year: "numeric" })}${s === today() ? ", сегодня" : ""}, событий: ${ev.length}${cats.length ? `, ${cats.map((c) => categories[c]).join(", ")}` : ""}`}
                onClick={() => choose(s)}
              >
                <span>{date(s).getDate()}</span>
                <span className="dots" aria-hidden="true">
                  {cats.map((c) => (
                    <i key={c} className={`dot ${c}`} />
                  ))}
                </span>
              </button>
            );
          })}
        </div>
        <div className="legend">
          {Object.entries(categories).map(([k, v]) => (
            <span key={k}>
              <i className={`dot ${k}`} />
              {v}
            </span>
          ))}
        </div>
      </section>
      <div className="section-title">
        <div>
          <h2>
            {selected === today()
              ? "Сегодня"
              : fmt(selected, { weekday: "long" })}
            , {fmt(selected, { day: "numeric", month: "short" })}
          </h2>
          <p>
            Выполнено {done.length} из {events.length}
          </p>
        </div>
        <CalendarDays size={23} />
      </div>
      {todo.length ? (
        todo.map(task)
      ) : (
        <Empty
          title={done.length ? "Всё на этот день готово" : "Свободный день"}
        >
          {done.length
            ? "Можно просто побыть рядом."
            : "Добавьте визит, уход или тренировку."}
        </Empty>
      )}
      {done.length > 0 && (
        <details className="completed">
          <summary>Выполнено · {done.length}</summary>
          {done.map(task)}
        </details>
      )}
      <button className="primary" onClick={onAdd}>
        <Plus size={18} /> Добавить событие
      </button>
      {overdue.length > 0 && (
        <aside className="notice">
          <strong>Есть незавершённые дела · {overdue.length}</strong>
          {overdue.map((e) => (
            <button
              key={e.id}
              className="text-button"
              onClick={() => onDetail(e, e.date)}
            >
              {e.name} · {fmt(e.date)} → перенести или отметить
            </button>
          ))}
        </aside>
      )}
    </>
  );
}
