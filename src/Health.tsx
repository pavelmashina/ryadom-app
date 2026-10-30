import { Button, Card, Empty, IconButton } from "./components";
import { CalendarPlus, ChevronDown, FileText, Pencil, Plus } from "lucide-react";
import { fmt, type Pet } from "./domain";
import "./health.css";

export default function Health({
  pet,
  onWeight,
  onRecord,
  onEditWeight,
  onEditRecord,
  onSummary,
  onPlan,
  readOnly = false,
}: {
  pet: Pet;
  onWeight: () => void;
  onRecord: () => void;
  onEditWeight: (id: string) => void;
  onEditRecord: (id: string) => void;
  onSummary: () => void;
  onPlan: (name: string, id?: string) => void;
  readOnly?: boolean;
}) {
  const weights = [...pet.weights].sort((a, b) => b.date.localeCompare(a.date));
  const records = [...pet.records].sort((a, b) => b.date.localeCompare(a.date));

  return (
    <section className="health-screen" aria-labelledby="health-screen-title">
      <h1 id="health-screen-title">Здоровье</h1>

      <section className="health-section" aria-labelledby="health-weight-title">
        <h2 id="health-weight-title">Вес</h2>
        <Card className="health-weight-card" variant="info">
          {weights[0] ? (
            <>
              <div className="health-current-weight">
                <div className="health-weight-value">
                  <strong>{weights[0].value.toLocaleString("ru-RU")}</strong>
                  <span>кг</span>
                </div>
                <span className="health-weight-date">{fmt(weights[0].date)}</span>
              </div>
              <details className="health-weight-history">
                <summary>
                  <span>История измерений ({weights.length})</span>
                  <ChevronDown aria-hidden="true" />
                </summary>
                <div className="health-history-list">
                  {weights.map((w) => (
                    <div className="health-history-row" key={w.id}>
                      <span className="health-history-date">
                        {fmt(w.date, { day: "numeric", month: "long", year: "numeric" })}
                      </span>
                      <strong>{w.value.toLocaleString("ru-RU")} кг</strong>
                      <IconButton
                        label={"Редактировать вес от " + fmt(w.date)}
                        disabled={readOnly}
                        onClick={() => onEditWeight(w.id)}
                      >
                        <Pencil aria-hidden="true" />
                      </IconButton>
                    </div>
                  ))}
                </div>
              </details>
            </>
          ) : (
            <p className="health-empty-weight">Измерений пока нет.</p>
          )}
          <Button onClick={onWeight} fullWidth variant="secondary" disabled={readOnly}>
            <Plus aria-hidden="true" />
            Записать вес
          </Button>
        </Card>
      </section>

      <section className="health-section" aria-labelledby="health-record-title">
        <h2 id="health-record-title">Медицинская история</h2>
        {records.length ? (
          <div className="health-record-list">
            {records.map((r) => {
              const linkedCount = pet.events.filter((e) => e.linkedRecord === r.id).length;
              return (
                <Card key={r.id} className="health-record-card">
                  <div className="health-record-head">
                    <div className="health-record-heading">
                      <span className="health-record-meta">{r.type} · {fmt(r.date)}</span>
                      <h3>{r.name}</h3>
                    </div>
                    <IconButton
                      label={"Редактировать запись: " + r.name}
                      disabled={readOnly}
                      onClick={() => onEditRecord(r.id)}
                    >
                      <Pencil aria-hidden="true" />
                    </IconButton>
                  </div>
                  {r.note?.trim() && <p className="health-record-note">{r.note}</p>}
                  {linkedCount > 0 && (
                    <p className="health-linked-count">Связано событий: {linkedCount}</p>
                  )}
                  <Button
                    onClick={() => onPlan(r.name, r.id)}
                    variant="secondary"
                    fullWidth
                    disabled={readOnly}
                  >
                    <CalendarPlus aria-hidden="true" />
                    Связать с событием
                  </Button>
                </Card>
              );
            })}
          </div>
        ) : (
          <Empty title="Пока нет медицинских записей">
            Добавьте визит, анализы, прививку или назначение.
          </Empty>
        )}
        <div className="health-actions">
          <Button onClick={onRecord} fullWidth variant="primary" disabled={readOnly}>
            <Plus aria-hidden="true" />
            Добавить запись
          </Button>
          <Button onClick={() => onPlan("")} fullWidth variant="secondary" disabled={readOnly}>
            Запланировать визит или прививку
          </Button>
          <Button onClick={onSummary} fullWidth variant="secondary" disabled={readOnly}>
            <FileText aria-hidden="true" />
            Сводка для ветеринара
          </Button>
        </div>
      </section>
    </section>
  );
}
