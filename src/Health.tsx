import { SectionHeader, PageHeader, Button, Card, Empty } from "./components";
import { Plus, FileText } from "lucide-react";
import { fmt, type Pet } from "./domain";
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
      <PageHeader title="Здоровье" eyebrow="История заботы">
        Записи, назначения и самочувствие
      </PageHeader>
      <Card variant="info">
        <SectionHeader title="Вес" compact>
          <span className="hint">
            {weights[0] ? fmt(weights[0].date) : "Нет записей"}
          </span>
        </SectionHeader>
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
        <Button onClick={onWeight} fullWidth variant="secondary">
          <Plus />
          Записать вес
        </Button>
      </Card>
      <SectionHeader title="Медицинская история">
      </SectionHeader>
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
              <Button onClick={() => onPlan(r.name, r.id)} variant="ghost">
                Связать с новым событием
              </Button>
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
      <Button onClick={onRecord} fullWidth variant="primary">
        <Plus />
        Добавить запись
      </Button>
      <Button onClick={() => onPlan("")} fullWidth variant="secondary">
        Запланировать визит или прививку
      </Button>
      <Button onClick={onSummary} fullWidth variant="secondary">
        <FileText />
        Сводка для ветеринара
      </Button>
    </>
  );
}
