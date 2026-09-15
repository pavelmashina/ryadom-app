import { Plus, CalendarPlus, GraduationCap } from "lucide-react";
import { mastery, fmt, type Pet } from "./domain";
import { Card, Empty } from "./components";
export default function Training({
  pet,
  onCommand,
  onSession,
  onPlan,
}: {
  pet: Pet;
  onCommand: () => void;
  onSession: (id: string) => void;
  onPlan: (name: string) => void;
}) {
  return (
    <>
      <div className="heading">
        <span className="eyebrow">Учимся вместе</span>
        <h1>Занятия</h1>
        <p>Маленькие шаги, заметный прогресс</p>
      </div>
      <details className="explanation">
        <summary>Как устроена шкала усвоения?</summary>
        <p>
          Последние 5 занятий команды: успешные повторы ÷ все повторы × 100%, с
          округлением до целого. Это правило приложения на основе ваших
          наблюдений, а не научная оценка.
        </p>
        <p>
          0–39% — начинает понимать; 40–69% — пока нестабильно; 70–89% —
          выполняет уверенно; 90–100% — хорошо усвоено.
        </p>
        <p>
          Меньше 3 занятий или 10 повторов — предварительная оценка. Успехи в
          разных условиях могут отличаться.
        </p>
      </details>
      <div className="section-title">
        <h2>Мои команды</h2>
        <button className="text-button" onClick={onCommand}>
          <Plus size={16} />
          Добавить
        </button>
      </div>
      {!pet.commands.length && (
        <Empty title="Первая команда">
          Добавьте команду, которую хотите разучить.
        </Empty>
      )}
      {pet.commands.map((c) => {
        const m = mastery(pet.sessions, c.id);
        return (
          <Card key={c.id}>
            <div className="section-title compact">
              <div className="command-title">
                <span className="icon-tile">
                  <GraduationCap size={21} />
                </span>
                <h2>«{c.name}»</h2>
              </div>
              <strong className="score">
                {m.percent === null ? "—" : `${m.percent}%`}
              </strong>
            </div>
            {m.percent !== null && (
              <progress
                max={100}
                value={m.percent}
                aria-label={`Усвоение команды ${c.name}: ${m.percent}%, ${m.label}`}
              />
            )}
            <strong>{m.label}</strong>
            {m.percent !== null && m.preliminary && (
              <span className="badge">Предварительная оценка</span>
            )}
            <p className="hint">
              {m.recent.length} занятий · {m.total} повторов
              {m.percent !== null ? ` · ${m.good} успешных` : ""}
            </p>
            {m.recent[0] && (
              <p className="hint">
                Последнее занятие:{" "}
                {fmt(m.recent[0].date, {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                })}
              </p>
            )}
            {m.recent.length > 0 && (
              <div className="results" aria-label="Недавние результаты">
                {m.recent.map((s) => (
                  <span key={s.id}>
                    {s.good}/{s.total}
                    <small>
                      {fmt(s.date, { day: "numeric", month: "short" })}
                    </small>
                  </span>
                ))}
              </div>
            )}
            <button className="primary" onClick={() => onSession(c.id)}>
              Записать занятие
            </button>
            <button
              className="text-button"
              onClick={() => onPlan(`Повторить «${c.name}»`)}
            >
              <CalendarPlus size={16} />
              Запланировать
            </button>
          </Card>
        );
      })}
      <div className="section-title">
        <h2>Дневник занятий</h2>
      </div>
      {pet.sessions.length ? (
        [...pet.sessions]
          .reverse()
          .sort((a, b) => b.date.localeCompare(a.date))
          .map((s) => (
            <Card key={s.id}>
              <span className="eyebrow">
                {fmt(s.date)} · {s.minutes} мин
              </span>
              <h3>
                {pet.commands.find((c) => c.id === s.command)?.name} · {s.good}{" "}
                из {s.total}
              </h3>
              <p className="note">{s.note || "Без заметки"}</p>
            </Card>
          ))
      ) : (
        <Empty title="Занятий пока нет">
          После тренировки запишите результат.
        </Empty>
      )}
    </>
  );
}
