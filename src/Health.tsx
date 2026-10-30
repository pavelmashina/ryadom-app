import { useState } from "react";
import { Button, Card, Empty, IconButton } from "./components";
import { ArrowLeft, CalendarPlus, ChevronRight, FileText, Paperclip, Pencil, Plus } from "lucide-react";
import { fmt, type Pet } from "./domain";
import WeightChart from "./WeightChart";
import { downloadMedicalHistory } from "./medical-history-export";
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
  const [weightDetails, setWeightDetails] = useState(false);
  const weights = [...pet.weights].sort((a, b) => b.date.localeCompare(a.date));
  const records = [...pet.records].sort((a, b) => b.date.localeCompare(a.date));
  const addWeight = (
    <IconButton label="Записать вес" className="health-weight-add"
      onClick={onWeight} disabled={readOnly}>
      <Plus aria-hidden="true" />
    </IconButton>
  );

  if (weightDetails) {
    return (
      <section className="health-screen health-weight-page" aria-label="История веса">
        <div className="health-title-row">
          <IconButton label="Вернуться к здоровью" onClick={() => setWeightDetails(false)}>
            <ArrowLeft aria-hidden="true" />
          </IconButton>
          <h2>Вес</h2>
          {addWeight}
        </div>
        <Card className="health-weight-card" variant="info">
          {weights.length ? <>
            <div className="health-current-weight">
              <div className="health-weight-value">
                <strong>{weights[0].value.toLocaleString("ru-RU")}</strong>
                <span>кг</span>
              </div>
              <span className="health-weight-date">{fmt(weights[0].date)}</span>
            </div>
            <WeightChart measurements={weights} />
          </> : <p className="health-empty-weight">Измерений пока нет.</p>}
        </Card>
        <h3 className="health-list-title">История измерений</h3>
        {weights.length ? (
          <Card className="health-weight-list">
            {weights.map((w) => (
              <div className="health-history-row" key={w.id}>
                <span className="health-history-date">
                  {fmt(w.date, { day: "numeric", month: "long", year: "numeric" })}
                </span>
                <strong>{w.value.toLocaleString("ru-RU")} кг</strong>
                <IconButton
                  label={"Редактировать вес от " + fmt(w.date)}
                  disabled={readOnly}
                  onClick={() => onEditWeight(w.id)}>
                  <Pencil aria-hidden="true" />
                </IconButton>
              </div>
            ))}
          </Card>
        ) : <Empty title="Измерений пока нет">Добавьте первое измерение веса.</Empty>}
      </section>
    );
  }

  return (
    <section className="health-screen" aria-label="Здоровье">
      <section className="health-section" aria-labelledby="health-weight-title">
        <div className="health-title-row">
          <h2 id="health-weight-title">Вес</h2>
          {addWeight}
        </div>
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
              <WeightChart measurements={weights} compact />
            </>
          ) : <p className="health-empty-weight">Измерений пока нет.</p>}
          <button type="button" className="health-weight-open"
            onClick={() => setWeightDetails(true)}>
            Посмотреть все измерения
            <ChevronRight aria-hidden="true" />
          </button>
        </Card>
      </section>

      <section className="health-section" aria-labelledby="health-record-title">
        <h2 id="health-record-title">Медицинская история</h2>
        {records.length ? (
          <div className="health-record-list">
            {records.map((r) => {
              const linkedCount = pet.events.filter((e) => e.linkedRecord === r.id).length;
              const attachments = pet.documents.filter((d) => d.linkedRecord === r.id);
              return (
                <Card key={r.id} className="health-record-card">
                  <div className="health-record-head">
                    <div className="health-record-heading">
                      <span className="health-record-meta">{r.type} · {fmt(r.date)}</span>
                      <h3>{r.name}</h3>
                    </div>
                    <IconButton label={"Редактировать запись: " + r.name}
                      disabled={readOnly} onClick={() => onEditRecord(r.id)}>
                      <Pencil aria-hidden="true" />
                    </IconButton>
                  </div>
                  {r.note?.trim() && <p className="health-record-note">{r.note}</p>}
                  {attachments.length > 0 && (
                    <div className="health-attachments" aria-label="Файлы медицинской записи">
                      {attachments.map((d) => (
                        <a href={d.data} download={d.filename} key={d.id}
                          className="health-attachment-link">
                          <Paperclip aria-hidden="true" />
                          <span>{d.filename}</span>
                        </a>
                      ))}
                    </div>
                  )}
                  {linkedCount > 0 && (
                    <p className="health-linked-count">Связано событий: {linkedCount}</p>
                  )}
                  <Button onClick={() => onPlan(r.name, r.id)} variant="secondary"
                    fullWidth disabled={readOnly}>
                    <CalendarPlus aria-hidden="true" />
                    Связать с событием
                  </Button>
                </Card>
              );
            })}
          </div>
        ) : <Empty title="Пока нет медицинских записей">
          Добавьте визит, анализы, прививку или назначение.
        </Empty>}
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
          <Button onClick={() => downloadMedicalHistory(pet)} fullWidth variant="secondary">
            <FileText aria-hidden="true" />
            Скачать медицинскую историю
          </Button>
        </div>
      </section>
    </section>
  );
}
