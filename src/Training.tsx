import {
  SectionHeader,
  Textarea,
  Select,
  PageHeader,
  Button,
  InteractiveCard,
  Card,
  Empty,
  Field,
  Form,
  Modal,
  Badge,
  text,
} from "./components";
import { useState } from "react";
import { fmt, id, today, type Pet } from "./domain";
import {
  commandProgress,
  SCORE_LABELS,
  trainingSchema,
  validateCommandName,
  type TrainingSession,
} from "./training-domain";
import "./training.css";
import TrainingHistory from "./TrainingHistory";
import CommandGrid from "./CommandGrid";
import { setCommandArchived, selectableCommands } from "./command-catalog";
type View =
  | { kind: "archive"; id: string }
  | {
      kind: "edit";
      session?: TrainingSession;
    }
  | {
      kind: "session";
      id: string;
    }
  | {
      kind: "command";
      id: string;
    }
  | {
      kind: "addCommand";
    }
  | null;
export default function Training({
  pet,
  onSave,
  onPlan,
  canEdit = false,
}: {
  pet: Pet;
  canEdit?: boolean;
  onSave: (pet: Pet) => Promise<void>;
  onPlan: (name: string) => void;
}) {
  const [view, setView] = useState<View>(null);
  const diary = pet.trainingDiary ?? [];
  const sourceEntry = diary.find((d) => d.session_id === selectedId());
  function selectedId() {
    return view?.kind === "session" ? view.id : undefined;
  }
  const learningNotes = Object.assign(
    {},
    ...diary.map((d) => d.details.commandNotes ?? {}),
  ) as Record<string, string>;
  const sessions = [...pet.workouts].sort(
    (a, b) =>
      b.date.localeCompare(a.date) || b.created_at.localeCompare(a.created_at),
  );
  const selected =
    view?.kind === "session"
      ? sessions.find((s) => s.id === view.id)
      : undefined;
  const command =
    view?.kind === "command" || view?.kind === "archive"
      ? pet.commands.find((c) => c.id === view.id)
      : undefined;
  const progress = command ? commandProgress(sessions, command.id) : null;
  const activeCommands = pet.commands.filter((c) => !c.archived);
  const archivedCommands = pet.commands.filter((c) => c.archived);
  function requireEdit() {
    if (!canEdit) throw new Error("Доступно только чтение");
  }
  async function saveCommand(name: string) {
    requireEdit();
    const next = { id: id(), name: validateCommandName(name, pet.commands) };
    await onSave({ ...pet, commands: [...pet.commands, next] });
    setView(null);
  }
  return (
    <>
      <PageHeader title="Занятия" eyebrow="Учимся вместе">
        Небольшие шаги, заметный прогресс · {pet.name}
      </PageHeader>
      <Button
        disabled={!canEdit}
        onClick={() => setView({ kind: "edit" })}
        fullWidth
        variant="primary"
      >
        Добавить тренировку
      </Button>
      <SectionHeader title="Команды">
        <Button
          disabled={!canEdit}
          onClick={() => setView({ kind: "addCommand" })}
          variant="ghost"
        >
          Добавить команду
        </Button>
      </SectionHeader>
      {!activeCommands.length && (
        <Empty title="Начните с первой команды">
          Команды принадлежат только этому питомцу.
        </Empty>
      )}
      <CommandGrid>
        {activeCommands.map((c) => {
          const p = commandProgress(sessions, c.id);
          return (
            <InteractiveCard
              key={c.id}
              onClick={() => setView({ kind: "command", id: c.id })}
              className="command-row"
              aria-label={
                c.name +
                ", " +
                p.status +
                ", " +
                (p.average === null
                  ? "без оценки"
                  : p.average.toFixed(1) + " из 5") +
                ", тренировок: " +
                p.count
              }
            >
              <span className="command-compact">
                <strong className="command-name" title={c.name}>
                  {c.name}
                </strong>
                <span className="command-rating">
                  {p.average === null ? "—" : p.average.toFixed(1) + "/5"}
                </span>
                <span className="command-scale" aria-hidden="true">
                  {Array.from({ length: 5 }, (_, i) => (
                    <span key={i}>
                      <i
                        style={{
                          width:
                            (p.average === null
                              ? 0
                              : Math.max(0, Math.min(1, p.average - i))) *
                              100 +
                            "%",
                        }}
                      />
                    </span>
                  ))}
                </span>
              </span>
            </InteractiveCard>
          );
        })}
      </CommandGrid>
      {!!archivedCommands.length && (
        <details className="explanation">
          <summary>Удалённые из списка · {archivedCommands.length}</summary>
          <p>История и оценки этих команд сохранены.</p>
          {archivedCommands.map((c) => (
            <Button
              key={c.id}
              variant="ghost"
              onClick={() => setView({ kind: "command", id: c.id })}
            >
              {c.name}
            </Button>
          ))}
        </details>
      )}
      <TrainingHistory
        key={pet.id}
        sessions={sessions}
        commands={pet.commands}
        readOnly={!canEdit}
        onOpen={(id) => setView({ kind: "session", id })}
        onEdit={(session) => setView({ kind: "edit", session })}
      />
      {!!diary.length && (
        <details className="explanation">
          <summary>Исходный дневник · {diary.length} записей</summary>
          <p>
            Оценки восстановлены по тексту, а не по числу успешных повторов.
            Пропуски не влияют на прогресс. Исходные записи сохранены отдельно
            от редактируемых тренировок.
          </p>
          {diary.map((d) => (
            <details key={d.source_key}>
              <summary>
                {fmt(d.date, {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                })}{" "}
                ·{" "}
                {d.status === "skipped"
                  ? "Пропуск"
                  : d.status === "linked"
                    ? "Уже в приложении"
                    : "Занятие"}
              </summary>
              <p className="note">{d.original_text}</p>
              {d.session_id && sessions.some((s) => s.id === d.session_id) && (
                <Button
                  variant="ghost"
                  onClick={() =>
                    setView({ kind: "session", id: d.session_id! })
                  }
                >
                  Открыть тренировку
                </Button>
              )}
            </details>
          ))}
        </details>
      )}
      {!!pet.sessions.length && (
        <details className="explanation">
          <summary>Архив занятий с повторами · {pet.sessions.length}</summary>
          <p>
            Старые результаты сохранены. Повторы не переводятся автоматически в
            оценку 1–5.
          </p>
          {pet.sessions.map((s) => (
            <p key={s.id}>
              {fmt(s.date)} ·{" "}
              {pet.commands.find((c) => c.id === s.command)?.name} · {s.good}/
              {s.total} · {s.note}
            </p>
          ))}
        </details>
      )}
      <details className="explanation">
        <summary>Как считается прогресс</summary>
        <p>
          Средняя оценка последних пяти тренировок с этой командой: ниже 2,5 —
          изучаем; от 2,5 — нестабильно; от 3,5 — уверенно; от 4,5 — усвоено. До
          трёх тренировок оценка предварительная. Это ориентир для дневника.
        </p>
      </details>
      {view && (
        <Modal
          title={
            view.kind === "edit"
              ? view.session
                ? "Редактировать тренировку"
                : "Новая тренировка"
              : view.kind === "addCommand"
                ? "Новая команда"
                : (command?.name ?? "Тренировка")
          }
          onClose={() => setView(null)}
        >
          {view.kind === "edit" && canEdit && (
            <TrainingForm
              pet={pet}
              session={view.session}
              onSave={async (next, commands) => {
                requireEdit();
                await onSave({
                  ...pet,
                  commands,
                  workouts: [
                    ...pet.workouts.filter((s) => s.id !== next.id),
                    next,
                  ],
                });
                setView({ kind: "session", id: next.id });
              }}
            />
          )}
          {view.kind === "addCommand" && canEdit && (
            <Form onSave={(d) => saveCommand(text(d, "name"))}>
              <Field
                label="Название команды"
                name="name"
                required
                maxLength={120}
              />
            </Form>
          )}
          {selected && (
            <>
              <p>
                {fmt(selected.date, {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                })}{" "}
                ·{" "}
                {selected.duration_minutes
                  ? selected.duration_minutes + " мин"
                  : "Длительность не указана"}
              </p>
              {sourceEntry && (
                <>
                  <Badge>
                    {sourceEntry.status === "linked"
                      ? "Связано с дневником"
                      : "Восстановлено из дневника"}
                  </Badge>
                  <details className="explanation">
                    <summary>Исходная запись</summary>
                    <p className="note">{sourceEntry.original_text}</p>
                  </details>
                </>
              )}
              <p className="note">
                {selected.comment || "Без общего комментария"}
              </p>
              {selected.results.map((r) => (
                <Card key={r.command_id}>
                  <h3>
                    {pet.commands.find((c) => c.id === r.command_id)?.name}
                  </h3>
                  <p>
                    {r.performance_score} / 5 —{" "}
                    {SCORE_LABELS[r.performance_score - 1]}
                  </p>
                  <small>
                    {
                      {
                        new: "Изучали впервые",
                        learning: "Продолжали изучать",
                        repeat: "Повторяли",
                      }[r.mode]
                    }
                  </small>
                  <p className="note">
                    {r.comment || "Без комментария к команде"}
                  </p>
                </Card>
              ))}
              <Button
                disabled={!canEdit}
                onClick={() => setView({ kind: "edit", session: selected })}
                fullWidth
                variant="primary"
              >
                Редактировать тренировку
              </Button>
            </>
          )}
          {view.kind === "archive" && command && canEdit && (
            <Form
              label={command.archived ? "Вернуть в список" : "Удалить команду"}
              variant={command.archived ? "primary" : "destructive"}
              onSave={async () => {
                requireEdit();
                await onSave(
                  setCommandArchived(pet, command.id, !command.archived),
                );
                setView(null);
              }}
            >
              <p>
                {command.archived ? "Вернуть" : "Удалить"} команду «
                {command.name}»?
              </p>
              <p>
                Команда {command.archived ? "появится в" : "исчезнет из"}{" "}
                активного списка и выбора для новых тренировок. Прошлые
                тренировки, оценки и исходный дневник сохранятся.
              </p>
              <Button
                variant="ghost"
                onClick={() => setView({ kind: "command", id: command.id })}
              >
                Отмена
              </Button>
            </Form>
          )}
          {view.kind === "command" && command && progress && (
            <>
              <h3>
                {progress.status}{" "}
                {progress.average !== null &&
                  "· " + progress.average.toFixed(1) + " / 5"}
              </h3>
              {learningNotes[command.name] && (
                <p className="note">{learningNotes[command.name]}</p>
              )}
              {progress.preliminary && (
                <Badge tone="warning">Предварительная оценка</Badge>
              )}
              <p>
                Тренировок: {progress.count} · Последняя:{" "}
                {progress.lastDate ? fmt(progress.lastDate) : "ещё не было"}
              </p>
              <div className="score-history" aria-label="История оценок">
                {[...progress.history].reverse().map((x) => (
                  <div key={x.session.id}>
                    <meter min={0} max={5} value={x.result.performance_score} />
                    <span>{fmt(x.session.date)}</span>
                    <strong>{x.result.performance_score}/5</strong>
                  </div>
                ))}
              </div>
              {progress.history.map((x) => (
                <InteractiveCard
                  key={x.session.id}
                  onClick={() => setView({ kind: "session", id: x.session.id })}
                  className="training-row"
                >
                  <strong>
                    {fmt(x.session.date)} · {x.result.performance_score}/5
                  </strong>
                  <p className="note">
                    {x.result.comment || "Без комментария"}
                  </p>
                  <small>Открыть тренировку →</small>
                </InteractiveCard>
              ))}
              <Button
                disabled={!canEdit || !!command.archived}
                onClick={() => {
                  setView(null);
                  onPlan("Повторить «" + command.name + "»");
                }}
                fullWidth
                variant="secondary"
              >
                Запланировать повторение
              </Button>
              <Button
                disabled={!canEdit}
                fullWidth
                variant={command.archived ? "secondary" : "destructive"}
                onClick={() => setView({ kind: "archive", id: command.id })}
              >
                {command.archived ? "Вернуть в список" : "Удалить команду"}
              </Button>
            </>
          )}
        </Modal>
      )}
    </>
  );
}
export function TrainingForm({
  pet,
  session,
  onSave,
}: {
  pet: Pet;
  session?: TrainingSession;
  onSave: (s: TrainingSession, commands: Pet["commands"]) => Promise<void>;
}) {
  const [commands, setCommands] = useState(pet.commands);
  const [results, setResults] = useState<TrainingSession["results"]>(
    session?.results ?? [],
  );
  const [newName, setNewName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  function toggle(cid: string) {
    setResults((rs) =>
      rs.some((r) => r.command_id === cid)
        ? rs.filter((r) => r.command_id !== cid)
        : [
            ...rs,
            {
              command_id: cid,
              performance_score: 3,
              mode: "repeat",
              comment: "",
            },
          ],
    );
  }
  function add() {
    try {
      const name = validateCommandName(newName, commands),
        cid = id();
      setCommands((cs) => [...cs, { id: cid, name }]);
      setResults((rs) => [
        ...rs,
        { command_id: cid, performance_score: 3, mode: "new", comment: "" },
      ]);
      setNewName("");
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Проверьте название");
    }
  }
  return (
    <Form
      onSave={async (d) => {
        if (busy) return;
        setBusy(true);
        try {
          const parsed = trainingSchema.safeParse({
            id: session?.id ?? id(),
            date: text(d, "date"),
            duration_minutes: text(d, "duration")
              ? Number(text(d, "duration"))
              : null,
            comment: text(d, "comment"),
            created_at: session?.created_at ?? new Date().toISOString(),
            updated_at: new Date().toISOString(),
            results,
          });
          if (!parsed.success) throw new Error(parsed.error.issues[0].message);
          await onSave(parsed.data, commands);
        } finally {
          setBusy(false);
        }
      }}
    >
      <fieldset disabled={busy} className="training-fields">
        <Field
          label="Дата тренировки"
          name="date"
          type="date"
          required
          defaultValue={session?.date ?? today()}
        />
        <Field
          label="Длительность, минут · необязательно"
          name="duration"
          type="number"
          min={1}
          max={600}
          step={1}
          defaultValue={session?.duration_minutes ?? ""}
        />
        <Textarea
          label="Общий комментарий"
          name="comment"
          maxLength={5000}
          defaultValue={session?.comment ?? ""}
        />
        <h3>Выберите команды</h3>
        <p aria-live="polite">Выбрано: {results.length}</p>
        <CommandGrid>
          {selectableCommands(commands, session).map((c) => (
            <Button
              type="button"
              aria-pressed={results.some((r) => r.command_id === c.id)}
              key={c.id}
              onClick={() => toggle(c.id)}
              variant="secondary"
              className="card command-row command-choice"
              aria-label={
                c.name +
                (c.archived
                  ? " — удалена из списка, сохранена в этой тренировке"
                  : "")
              }
              title={c.name}
            >
              <span className="command-choice-name">{c.name}</span>
              <span className="command-choice-state">
                {results.some((r) => r.command_id === c.id)
                  ? "✓ Выбрана"
                  : c.archived
                    ? "Из истории"
                    : "Выбрать"}
              </span>
            </Button>
          ))}
        </CommandGrid>
        {session?.results.some(
          (r) => commands.find((c) => c.id === r.command_id)?.archived,
        ) && (
          <p className="hint">
            Команды, удалённые из списка, сохранены в этой тренировке вместе с
            оценками.
          </p>
        )}
        <div className="inline-command">
          <Field
            label="Новая команда"
            value={newName}
            maxLength={120}
            onChange={(e) => setNewName(e.target.value)}
          />
          <Button type="button" onClick={add} fullWidth variant="secondary">
            Добавить
          </Button>
        </div>
        {error && (
          <p role="alert" className="notice">
            {error}
          </p>
        )}
        {results.map((r) => (
          <Card key={r.command_id}>
            <h3>{commands.find((c) => c.id === r.command_id)?.name}</h3>
            <Select
              label="Что делали"
              value={r.mode}
              onChange={(e) =>
                setResults((rs) =>
                  rs.map((x) =>
                    x.command_id === r.command_id
                      ? { ...x, mode: e.target.value as typeof r.mode }
                      : x,
                  ),
                )
              }
            >
              <option value="new">Изучали впервые</option>
              <option value="learning">Продолжали изучать</option>
              <option value="repeat">Повторяли</option>
            </Select>
            <div
              className="score-buttons"
              role="group"
              aria-label={
                "Оценка " + commands.find((c) => c.id === r.command_id)?.name
              }
            >
              {SCORE_LABELS.map((label, i) => (
                <Button
                  type="button"
                  key={label}
                  title={label}
                  aria-label={i + 1 + " — " + label}
                  aria-pressed={r.performance_score === i + 1}
                  onClick={() =>
                    setResults((rs) =>
                      rs.map((x) =>
                        x.command_id === r.command_id
                          ? { ...x, performance_score: i + 1 }
                          : x,
                      ),
                    )
                  }
                  variant="ghost"
                >
                  {i + 1}
                </Button>
              ))}
            </div>
            <p>{SCORE_LABELS[r.performance_score - 1]}</p>
            <Textarea
              label="Комментарий к команде"
              maxLength={5000}
              value={r.comment}
              onChange={(e) =>
                setResults((rs) =>
                  rs.map((x) =>
                    x.command_id === r.command_id
                      ? { ...x, comment: e.target.value }
                      : x,
                  ),
                )
              }
            />
          </Card>
        ))}
      </fieldset>
    </Form>
  );
}
