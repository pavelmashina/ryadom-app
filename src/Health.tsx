import { Plus, FileText } from "lucide-react";
import { fmt, type Pet } from "./domain";
import { Card, Empty } from "./components";
export default function Health({
  pet,
  onWeight,
  onRecord,
  onSummary,
  onPlan,
}: {
  pet: Pet;
  onWeight: () => void;
  onRecord: () => void;
  onSummary: () => void;
  onPlan: (name: string, id?: string) => void;
}) {
  const weights = [...pet.weights].sort((a, b) => b.date.localeCompare(a.date));
  return (
    <>
      <div className="heading">
        <span className="eyebrow">История заботы</span>
        <h1>Здоровье</h1>
        <p>Записи, назначения и самочувствие</p>
      </div>
      <Card>
        <div className="section-title compact">
          <h2>Вес</h2>
          <span className="hint">
            {weights[0] ? fmt(weights[0].date) : "Нет записей"}
          </span>
        </div>
        {weights[0] ? (
          <>
            <div className="large">
              {weights[0].value.toLocaleString("ru-RU")} <small>кг</small>
            </div>
            <div className="results">
              {weights.slice(0, 3).map((w) => (
                <span key={w.id}>
                  {w.value} кг<small>{fmt(w.date)}</small>
                </span>
              ))}
            </div>
            <details>
              <summary>Вся история · {weights.length}</summary>
              {weights.map((w) => (
                <p key={w.id}>
                  {fmt(w.date, {
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                  })}{" "}
                  · {w.value} кг
                </p>
              ))}
            </details>
          </>
        ) : (
          <p>Добавьте первое измерение.</p>
        )}
        <button className="secondary" onClick={onWeight}>
          <Plus size={17} />
          Записать вес
        </button>
      </Card>
      <div className="section-title">
        <h2>Медицинская история</h2>
      </div>
      {pet.records.length ? (
        [...pet.records]
          .sort((a, b) => b.date.localeCompare(a.date))
          .map((r) => (
            <Card key={r.id}>
              <span className="eyebrow">
                {r.type} · {fmt(r.date)}
              </span>
              <h3>{r.name}</h3>
              <p className="note">{r.note || "Без заметки"}</p>
              <button
                className="text-button"
                onClick={() => onPlan(r.name, r.id)}
              >
                Связать с новым событием
              </button>
              {pet.events.some((e) => e.linkedRecord === r.id) && (
                <p className="hint">
                  Связано событий:{" "}
                  {pet.events.filter((e) => e.linkedRecord === r.id).length}
                </p>
              )}
            </Card>
          ))
      ) : (
        <Empty title="Пока нет медицинских записей">
          Добавьте визит, анализы, прививку или назначение.
        </Empty>
      )}
      <button className="primary" onClick={onRecord}>
        <Plus size={18} />
        Добавить запись
      </button>
      <button className="secondary" onClick={() => onPlan("")}>
        Запланировать визит или прививку
      </button>
      <button className="secondary" onClick={onSummary}>
        <FileText size={18} />
        Сводка для ветеринара
      </button>
    </>
  );
}
