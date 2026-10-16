import {
  SectionHeader,
  Button,
  InteractiveCard,
  IconButton,
  Card,
  Empty,
  Modal,
  Form,
  Field,
  Select,
  Note,
  text,
  number,
} from "./components";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Sharing, JoinPet } from "./Sharing";
import type { AuthSession } from "./backend";
import {
  PawPrint,
  Dog,
  ChevronDown,
  CalendarDays,
  HeartPulse,
  GraduationCap,
  Package,
  Download,
  UserRound,
  ArrowLeft,
} from "lucide-react";
import Calendar from "./Calendar";
import Training from "./Training";
import Health from "./Health";
import Stock from "./Stock";
import EventForm from "./EventForm";
import ReminderSettings from "./ReminderSettings";
import FirstPetSetup from "./FirstPetSetup";
import { needsFirstPetSetup, type PetBasics } from "./first-pet-setup";
import { saveWeight, deleteWeight, saveMedicalRecord, deleteMedicalRecord, deletePetDocument } from "./health-actions";
import { setPersonalReminder } from "./push-api";
import {
  blankPet,
  demoPet,
  today,
  fmt,
  id,
  completionKey,
  moveEvent,
  sessionSchema,
  petSchema,
  type Pet,
  type PetEvent,
  type State,
} from "./domain";
import { parseBackup, download } from "./storage";
import { recurrenceText, previousDay } from "./recurrence";
import { joinCodeFromUrl } from "./share-invitation";
import { completeShoppingItem, restoreShoppingItem } from "./shopping-checkout";
type Screen = "day" | "health" | "training" | "stock" | "profile" | "account";
type EventScope = "single" | "future" | "all";
type Overlay =
  | {
      kind: "event";
      category?: PetEvent["category"];
      name?: string;
      linkedRecord?: string;
    }
  | {
      kind: "detail";
      event: PetEvent;
      on: string;
    }
  | {
      kind: "session";
      command: string;
    }
  | {
      kind: "modifyEvent";
      eventId: string;
      on: string;
      action: "edit" | "delete";
    }
  | {
      kind: "finishShopping";
      itemId: string;
    }
  | {
      kind: "editWeight" | "editRecord" | "deleteWeight" | "deleteRecord" | "deleteDocument";
      entryId: string;
    }
  | {
      kind:
        | "pets"
        | "sharing"
        | "join"
        | "newpet"
        | "editpet"
        | "command"
        | "weight"
        | "record"
        | "summary"
        | "stock"
        | "ration"
        | "shopping"
        | "document"
        | "backup";
    };
const nav = [
  ["day", "День", CalendarDays],
  ["health", "Здоровье", HeartPulse],
  ["training", "Занятия", GraduationCap],
  ["stock", "Запасы", Package],
] as const;
export default function App({
  initial,
  onPersist,
  accountContent,
  session,
  onRefresh,
}: {
  initial: State;
  onPersist: (next: State, before: State) => Promise<State>;
  accountContent: ReactNode;
  session: AuthSession;
  onRefresh: () => Promise<State>;
}) {
  const loaded = { state: initial, error: "" };
  const saving = useRef(false);
  const epoch = useRef(0);
  const [openTraining, setOpenTraining] = useState<string | undefined>();
  const [showFirstPetSetup, setShowFirstPetSetup] = useState(() => needsFirstPetSetup(initial));
  const handledPushLink = useRef(false);
  const handledJoinLink = useRef(false);
  const [joinCode, setJoinCode] = useState<string | null>(() => joinCodeFromUrl(location.search));
  const [eventScope, setEventScope] = useState<EventScope>("single");
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState(loaded.state),
    [storageError, setStorageError] = useState(loaded.error),
    [notice, setNotice] = useState(""),
    [screen, setScreen] = useState<Screen>("day"),
    [overlay, setOverlay] = useState<Overlay | null>(null),
    [selected, setSelected] = useState(today()),
    [month, setMonth] = useState(today().slice(0, 7) + "-01"),
    [restore, setRestore] = useState<State | null>(null);
  const pet = state.pets.find((p) => p.id === state.selectedPet)!;
  useEffect(() => {
    if (handledJoinLink.current) return;
    const code = joinCodeFromUrl(location.search);
    if (!code) return;
    handledJoinLink.current = true;
    setJoinCode(code);
    setOverlay({ kind: "join" });
    const params = new URLSearchParams(location.search);
    params.delete("join");
    history.replaceState(null, "", location.pathname + (params.toString() ? "?" + params.toString() : "") + location.hash);
  }, []);
  useEffect(() => {
    if (handledPushLink.current) return;
    const params = new URLSearchParams(location.search);
    const eventId = params.get("event");
    if (!eventId) return;
    const matchedPet = state.pets.find((p) => p.events.some((e) => e.id === eventId));
    const event = matchedPet?.events.find((e) => e.id === eventId);
    if (!matchedPet || !event) return;
    const day = /^\\d{4}-\\d{2}-\\d{2}$/.test(params.get("date") || "")
      ? params.get("date")! : event.date;
    handledPushLink.current = true;
    if (matchedPet.id !== state.selectedPet) setState((previous) => ({
      ...previous, selectedPet: matchedPet.id,
    }));
    setSelected(day);
    setMonth(day.slice(0, 7) + "-01");
    setScreen("day");
    setOverlay({ kind: "detail", event, on: day });
    history.replaceState(null, "", location.pathname + location.hash);
  }, [state]);
  const overlayRef = useRef(overlay);
  overlayRef.current = overlay;
  const refreshRef = useRef(onRefresh);
  refreshRef.current = onRefresh;
  useEffect(() => {
    let stopped = false,
      running = false;
    async function refresh() {
      if (running || saving.current || document.hidden) return;
      running = true;
      const stamp = epoch.current;
      try {
        const next = await refreshRef.current();
        if (stopped || saving.current || stamp !== epoch.current) return;
        setState((previous) => {
          const lost = previous.pets.some(
            (p) => !next.pets.some((n) => n.id === p.id),
          );
          if (
            document.querySelector("dialog[open]") &&
            !lost &&
            overlayRef.current?.kind !== "join"
          )
            return previous;
          if (lost) {
            setOverlay(null);
            setNotice(
              "Список питомцев обновлён. Доступ к одному из питомцев прекращён.",
            );
          }
          if (JSON.stringify(previous) === JSON.stringify(next))
            return previous;
          return {
            ...next,
            selectedPet: next.pets.some((p) => p.id === previous.selectedPet)
              ? previous.selectedPet
              : next.selectedPet,
          };
        });
      } catch {
        /* Keep the current draft during a transient network failure. Writes still require server authorization. */
      } finally {
        running = false;
      }
    }
    const timer = setInterval(refresh, 3000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      stopped = true;
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);
  async function refreshNow() {
    ++epoch.current;
    const next = await onRefresh();
    setState(next);
    if (!next.pets.some((p) => p.id === pet.id)) close();
  }
  async function commit(next: State) {
    if (saving.current) throw new Error("Дождитесь завершения сохранения");
    saving.current = true;
    ++epoch.current;
    setBusy(true);
    setNotice("Сохраняем в облаке…");
    try {
      const stored = await onPersist(next, state);
      setState(stored);
      setStorageError("");
      setNotice("Сохранено в облаке");
    } catch (e) {
      setNotice("Не удалось сохранить: " + (e instanceof Error ? e.message : "ошибка связи"));
      throw e;
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  async function finishFirstPetSetup(details?: PetBasics) {
    await update((p) => petSchema.parse({ ...p, ...details, onboardingCompleted: true }));
    setShowFirstPetSetup(false);
    setScreen("day");
  }
  function update(fn: (p: Pet) => Pet) {
    return commit({
      ...state,
      pets: state.pets.map((p) =>
        p.id === pet.id ? petSchema.parse(fn(p)) : p,
      ),
    });
  }
  async function safe(fn: () => void | Promise<void>) {
    try {
      await fn();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Не удалось сохранить");
    }
  }
  function close() {
    setOverlay(null);
  }
  async function saved(fn: () => void | Promise<void>) {
    await fn();
    close();
  }
  async function addEvent(e: PetEvent) {
    await saved(() => update((p) => ({ ...p, events: [...p.events, e] })));
    if (e.reminderEnabled) await syncPersonalReminder(e.id, e);
    setSelected(e.date);
    setMonth(e.date.slice(0, 7) + "-01");
    setScreen("day");
  }
  function modifyEvent(e: PetEvent, on: string, action: "edit" | "delete") {
    setEventScope(e.repeat === "once" ? "all" : "single");
    setOverlay({ kind: "modifyEvent", eventId: e.id, on, action });
  }
  async function syncPersonalReminder(eventId: string, event: PetEvent) {
    try {
      await setPersonalReminder(session, pet.id, eventId, Number(event.reminder), !!event.reminderEnabled);
    } catch (error) {
      console.warn("[reminder] event saved but personal reminder sync failed", error);
      setNotice("Событие сохранено, но личное напоминание не обновилось. Откройте карточку события и сохраните напоминание повторно.");
    }
  }
  async function saveEventEdit(e: PetEvent, on: string, scope: EventScope, next: PetEvent) {
    // Editing one occurrence or a future series creates a distinct event ID.
    // Attach the current user's reminder to that new ID, not the old series.
    const targetId = e.repeat !== "once" && scope !== "all" ? id() : e.id;
    await saved(() =>
      update((p) => {
        if (e.repeat === "once" || scope === "all")
          return {
            ...p,
            events: p.events.map((x) => x.id === e.id ? { ...next, id: e.id } : x),
          };
        const events = p.events.map((x) => x.id === e.id ? x : x);
        if (scope === "single") {
          const cancelled = {
            ...e,
            exceptions: [
              ...(e.exceptions ?? []).filter((x) => x.on !== on),
              { on, cancelled: true },
            ],
          };
          return {
            ...p,
            events: [
              ...events.map((x) => x.id === e.id ? cancelled : x),
              {
                ...next,
                id: targetId,
                repeat: "once" as const,
                end: "",
                repeatEndType: undefined,
                repeatCount: undefined,
                exceptions: undefined,
              },
            ],
          };
        }
        const past = {
          ...e,
          end: previousDay(on),
          repeatEndType: "date" as const,
          repeatCount: undefined,
          exceptions: (e.exceptions ?? []).filter((x) => x.on < on),
        };
        return {
          ...p,
          events: [
            ...events.filter((x) => x.id !== e.id),
            ...(on === e.date ? [] : [past]),
            { ...next, id: targetId, exceptions: undefined },
          ],
        };
      }),
    );
    await syncPersonalReminder(targetId, next);
    setSelected(next.date);
    setMonth(next.date.slice(0, 7) + "-01");
  }
  async function deleteEvent(e: PetEvent, on: string, scope: EventScope) {
    await saved(() =>
      update((p) => {
        if (e.repeat === "once" || scope === "all" || (scope === "future" && on === e.date)) {
          return {
            ...p,
            events: p.events.filter((x) => x.id !== e.id),
            done: Object.fromEntries(Object.entries(p.done).filter(([key]) => !key.startsWith(e.id + ":"))),
          };
        }
        const altered = scope === "single"
          ? {
              ...e,
              exceptions: [
                ...(e.exceptions ?? []).filter((x) => x.on !== on),
                { on, cancelled: true },
              ],
            }
          : {
              ...e,
              end: previousDay(on),
              repeatEndType: "date" as const,
              repeatCount: undefined,
              exceptions: (e.exceptions ?? []).filter((x) => x.on < on),
            };
        return {
          ...p,
          events: p.events.map((x) => x.id === e.id ? altered : x),
        };
      }),
    );
  }
  function toggle(e: PetEvent, s: string) {
    safe(() =>
      update((p) => ({
        ...p,
        done: {
          ...p.done,
          [completionKey(e, s)]: !p.done[completionKey(e, s)],
        },
      })),
    );
  }
  function choose(p: Pet) {
    safe(async () => {
      await commit({ ...state, selectedPet: p.id });
      setShowFirstPetSetup(false);
      close();
      setScreen("day");
      setSelected(today());
      setMonth(today().slice(0, 7) + "-01");
    });
  }
  function exportData() {
    download(`ryadom-backup-${today()}.json`, JSON.stringify(state, null, 2));
    setNotice("Резервная копия подготовлена");
  }
  const title =
    overlay?.kind === "event"
      ? "Новое событие"
      : overlay?.kind === "detail"
        ? overlay.event.name
        : overlay?.kind === "modifyEvent"
          ? overlay.action === "edit" ? "Редактировать событие" : "Удалить событие"
        : overlay?.kind === "session"
          ? `Занятие · ${pet.commands.find((c) => c.id === overlay.command)?.name}`
          : (
              {
                pets: "Мои питомцы",
                sharing: "Совместный доступ",
                join: "Добавить существующего питомца",
                newpet: "Новый питомец",
                editpet: "Данные питомца",
                command: "Новая команда",
                weight: "Записать вес",
                editWeight: "Редактировать вес",
                deleteWeight: "Удалить измерение",
                record: "Медицинская запись",
                editRecord: "Редактировать медицинскую запись",
                deleteRecord: "Удалить медицинскую запись",
                deleteDocument: "Удалить документ",
                summary: "Сводка для ветеринара",
                stock: "Пополнить корм",
                ration: "Расход и остаток",
                shopping: "Новая покупка",
                finishShopping: "Покупка выполнена",
                document: "Добавить документ",
                backup: "Резервные копии",
              } as Record<string, string>
            )[overlay?.kind || ""];
  function modalBody() {
    if (!overlay) return null;
    switch (overlay.kind) {
      case "sharing":
        return <Sharing session={session} pet={pet} onChanged={refreshNow} />;
      case "join":
        return <JoinPet session={session} onChanged={refreshNow} initialCode={joinCode} />;
      case "event":
        return (
          <EventForm
            selected={selected}
            session={session}
            pet={pet}
            onTrainingSave={(next) => saved(() => update(() => next))}
            category={overlay.category}
            name={overlay.name}
            linkedRecord={overlay.linkedRecord}
            onSave={addEvent}
          />
        );
      case "modifyEvent": {
        const current = pet.events.find((e) => e.id === overlay.eventId);
        if (!current) return <p>Событие больше недоступно.</p>;
        const scope = current.repeat === "once" ? "all" : eventScope;
        const editSource: PetEvent = scope === "all"
          ? current
          : {
              ...current,
              date: overlay.on,
              ...(scope === "single"
                ? { repeat: "once" as const, end: "", repeatEndType: undefined, repeatCount: undefined }
                : {}),
              exceptions: undefined,
            };
        return (
          <>
            {current.repeat !== "once" && (
              <Select
                label={overlay.action === "edit" ? "Изменить" : "Удалить"}
                value={scope}
                onChange={(e) => setEventScope(e.target.value as EventScope)}
              >
                <option value="single">Только это событие</option>
                <option value="future">Это и последующие</option>
                <option value="all">Все события серии</option>
              </Select>
            )}
            {overlay.action === "edit" ? (
              <EventForm
                key={scope}
                selected={overlay.on}
                existing={editSource}
                session={session}
                onSave={(next) => saveEventEdit(current, overlay.on, scope, next)}
              />
            ) : (
              <div>
                <p>Выбранные события будут удалены из календаря.</p>
                <Button fullWidth variant="primary"
                  onClick={() => safe(() => deleteEvent(current, overlay.on, scope))}>
                  Удалить
                </Button>
              </div>
            )}
          </>
        );
      }
      case "detail": {
        const e = pet.events.find((e) => e.id === overlay.event.id)!;
        const done = pet.done[completionKey(e, overlay.on)];
        return (
          <>
            <Card>
              <span className="eyebrow">
                {fmt(overlay.on, {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                })}
              </span>
              <h3>
                {e.time || "Весь день"} · {done ? "Выполнено" : "Запланировано"}
              </h3>
              <p>{e.kind === "reminder" ? "Напоминание" : "Событие"} · {recurrenceText(e)}</p>
              <p className="note">{e.note || "Заметка не добавлена"}</p>
              <p className="hint">Личные уведомления настраиваются ниже.</p>
            </Card>
            <Button
              onClick={() => toggle(e, overlay.on)}
              fullWidth
              variant="primary"
            >
              {done ? "Снять отметку о выполнении" : "Отметить выполненным"}
            </Button>
            <ReminderSettings
              session={session}
              petId={pet.id}
              eventId={e.id}
            />
            <div className="fields">
              <Button onClick={() => modifyEvent(e, overlay.on, "edit")} variant="secondary">
                Изменить
              </Button>
              <Button onClick={() => modifyEvent(e, overlay.on, "delete")} variant="ghost">
                Удалить
              </Button>
            </div>
            {e.repeat === "once" && !done && (
              <Form
                label="Перенести"
                onSave={async (d) => {
                  const to = text(d, "date");
                  await saved(() => update((p) => moveEvent(p, e.id, to)));
                  setSelected(to);
                  setMonth(to.slice(0, 7) + "-01");
                }}
              >
                <Field
                  label="Перенести на дату"
                  name="date"
                  type="date"
                  defaultValue={e.date}
                  required
                />
              </Form>
            )}
          </>
        );
      }
      case "pets":
        return (
          <>
            {state.pets.map((p) => (
              <InteractiveCard
                key={p.id}
                onClick={() => choose(p)}
                className="pet-row"
              >
                <span className="avatar">
                  <Dog />
                </span>
                <span>
                  <strong>{p.name}</strong>
                  <small>
                    {p.role === "editor" ? "Совместный доступ" : "Владелец"}
                    {p.pendingRequests
                      ? ` · Запросы: ${p.pendingRequests}`
                      : ""}
                  </small>
                </span>
                {p.id === pet.id ? "✓" : "→"}
              </InteractiveCard>
            ))}
            <Button
              onClick={() => setOverlay({ kind: "newpet" })}
              fullWidth
              variant="primary"
            >
              Добавить питомца
            </Button>
            <Button fullWidth onClick={() => setOverlay({ kind: "join" })}>
              Добавить существующего питомца
            </Button>
            <Button fullWidth onClick={() => setOverlay({ kind: "sharing" })}>
              Совместный доступ
              {pet.pendingRequests ? ` · ${pet.pendingRequests}` : ""}
            </Button>
            <Button
              onClick={() => {
                close();
                setScreen("profile");
              }}
              fullWidth
              variant="secondary"
            >
              Профиль · {pet.name}
            </Button>
            {!state.pets.some((p) => p.demo) && (
              <Button
                onClick={() =>
                  safe(async () => {
                    const p = demoPet();
                    await commit({
                      ...state,
                      pets: [...state.pets, p],
                      selectedPet: p.id,
                    });
                    close();
                    setScreen("day");
                  })
                }
                variant="ghost"
              >
                Открыть отдельный демонстрационный пример
              </Button>
            )}
          </>
        );
      case "newpet":
        return (
          <Form
            onSave={async (d) => {
              const p = blankPet(text(d, "name"));
              petSchema.parse(p);
              await saved(() =>
                commit({
                  ...state,
                  pets: [...state.pets, p],
                  selectedPet: p.id,
                }),
              );
              setScreen("profile");
            }}
          >
            <Field label="Имя" name="name" required maxLength={80} />
            <p className="hint">
              У нового питомца будут собственные календарь, здоровье, занятия и
              запасы.
            </p>
          </Form>
        );
      case "editpet":
        return (
          <Form
            onSave={async (d) =>
              await saved(() =>
                update((p) => ({
                  ...p,
                  name: text(d, "name"),
                  breed: text(d, "breed"),
                  birthday: text(d, "birthday"),
                  sex: text(d, "sex") as Pet["sex"],
                  chip: text(d, "chip"),
                })),
              )
            }
          >
            <Field
              label="Имя"
              name="name"
              defaultValue={pet.name}
              required
              maxLength={80}
            />
            <Field
              label="Порода"
              name="breed"
              defaultValue={pet.breed}
              maxLength={120}
            />
            <Field
              label="Дата рождения"
              name="birthday"
              type="date"
              max={today()}
              defaultValue={pet.birthday}
            />
            <Select label="Пол" name="sex" defaultValue={pet.sex}>
              <option value="">Не указан</option>
              <option>Девочка</option>
              <option>Мальчик</option>
            </Select>
            <Field
              label="Номер чипа"
              name="chip"
              defaultValue={pet.chip}
              maxLength={100}
            />
          </Form>
        );
      case "command":
        return (
          <Form
            onSave={async (d) => {
              const name = text(d, "name");
              if (!name) throw new Error("Введите название команды");
              if (
                pet.commands.some(
                  (c) => c.name.toLowerCase() === name.toLowerCase(),
                )
              )
                throw new Error("Такая команда уже есть");
              await saved(() =>
                update((p) => ({
                  ...p,
                  commands: [...p.commands, { id: id(), name }],
                })),
              );
            }}
          >
            <Field
              label="Название команды"
              name="name"
              placeholder="Например, Ко мне"
              required
              maxLength={80}
            />
          </Form>
        );
      case "session":
        return (
          <Form
            label="Сохранить результат"
            onSave={async (d) => {
              const s = sessionSchema.safeParse({
                id: id(),
                command: overlay.command,
                date: text(d, "date"),
                good: number(d, "good"),
                total: number(d, "total"),
                minutes: number(d, "minutes"),
                note: text(d, "note"),
              });
              if (!s.success) throw new Error(s.error.issues[0].message);
              if (s.data.date > today())
                throw new Error("Нельзя записать результат будущего занятия");
              await saved(() =>
                update((p) => ({ ...p, sessions: [...p.sessions, s.data] })),
              );
            }}
          >
            <Field
              label="Дата занятия"
              name="date"
              type="date"
              defaultValue={today()}
              max={today()}
              required
            />
            <div className="fields">
              <Field
                label="Успешно"
                name="good"
                type="number"
                min="0"
                max="1000"
                step="1"
                required
              />
              <Field
                label="Всего повторов"
                name="total"
                type="number"
                min="1"
                max="1000"
                step="1"
                required
              />
            </div>
            <Field
              label="Длительность, минут"
              name="minutes"
              type="number"
              min="1"
              max="600"
              step="1"
              required
            />
            <Note label="Как прошло?" />
            <p className="hint">
              Записывайте фактические наблюдения. После сохранения шкала этой
              команды обновится.
            </p>
          </Form>
        );
      case "weight":
      case "editWeight": {
        const existing = overlay.kind === "editWeight"
          ? pet.weights.find((w) => w.id === overlay.entryId) : undefined;
        if (overlay.kind === "editWeight" && !existing)
          return <p role="alert">Измерение больше недоступно.</p>;
        return (
          <>
            <Form label={existing ? "Сохранить вес" : "Добавить измерение"}
              onSave={async (d) => {
                await saved(() => update((p) => saveWeight(p, {
                  id: existing?.id ?? id(),
                  date: text(d, "date"),
                  value: number(d, "value"),
                })));
              }}
            >
              <Field label="Вес, кг" name="value" type="number" min="0.01"
                max="300" step="0.01" defaultValue={existing?.value ?? ""} required />
              <Field label="Дата измерения" name="date" type="date"
                defaultValue={existing?.date ?? today()} max={today()} required />
            </Form>
            {existing && (
              <Button fullWidth variant="ghost" onClick={() =>
                setOverlay({ kind: "deleteWeight", entryId: existing.id })
              }>Удалить измерение</Button>
            )}
          </>
        );
      }
      case "record":
      case "editRecord": {
        const existing = overlay.kind === "editRecord"
          ? pet.records.find((r) => r.id === overlay.entryId) : undefined;
        if (overlay.kind === "editRecord" && !existing)
          return <p role="alert">Медицинская запись больше недоступна.</p>;
        return (
          <>
            <Form label={existing ? "Сохранить изменения" : "Добавить запись"}
              onSave={async (d) => {
                await saved(() => update((p) => saveMedicalRecord(p, {
                  id: existing?.id ?? id(),
                  name: text(d, "name"),
                  date: text(d, "date"),
                  type: text(d, "type") as Pet["records"][number]["type"],
                  note: text(d, "note"),
                })));
              }}
            >
              <Select label="Тип записи" name="type" defaultValue={existing?.type ?? "Визит"}>
                {["Визит", "Анализы / УЗИ", "Прививка", "Назначение"].map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </Select>
              <Field label="Название" name="name" defaultValue={existing?.name ?? ""}
                required maxLength={120} />
              <Field label="Дата" name="date" type="date"
                defaultValue={existing?.date ?? today()} max={today()} required />
              <Note label="Результат или назначение" value={existing?.note ?? ""} />
              <p className="hint">После сохранения запись можно связать с событием. Файлы добавляются в документы профиля.</p>
            </Form>
            {existing && (
              <Button fullWidth variant="ghost" onClick={() =>
                setOverlay({ kind: "deleteRecord", entryId: existing.id })
              }>Удалить медицинскую запись</Button>
            )}
          </>
        );
      }
      case "deleteWeight":
      case "deleteRecord":
      case "deleteDocument": {
        const kind = overlay.kind;
        const entryId = overlay.entryId;
        const record = pet.records.find((r) => r.id === entryId);
        const documentEntry = pet.documents.find((d) => d.id === entryId);
        const exists = kind === "deleteWeight"
          ? pet.weights.some((w) => w.id === entryId)
          : kind === "deleteRecord" ? !!record : !!documentEntry;
        if (!exists) return <p role="alert">Запись больше недоступна.</p>;
        return (
          <Form label="Да, удалить" variant="destructive"
            onSave={async () => {
              await saved(() => update((p) => kind === "deleteWeight"
                ? deleteWeight(p, entryId)
                : kind === "deleteRecord"
                  ? deleteMedicalRecord(p, entryId)
                  : deletePetDocument(p, entryId)));
            }}
          >
            <p>Подтвердите удаление. Это действие нельзя отменить.</p>
            {kind === "deleteRecord" && pet.events.some((e) => e.linkedRecord === entryId) && (
              <p className="hint">Связанные события останутся в календаре, но связь с записью будет удалена.</p>
            )}
            {kind === "deleteDocument" && (
              <p className="hint">Файл «{documentEntry?.name}» будет удалён из карточки питомца и общей истории.</p>
            )}
          </Form>
        );
      }
      case "summary":
        return (
          <>
            <p className="notice">
              Предпросмотр сводки. Экспорт PDF пока не реализован.
            </p>
            <h3>
              {pet.name}
              {pet.demo ? " · демонстрационный пример" : ""}
            </h3>
            <p>
              {pet.breed || "Порода не указана"} ·{" "}
              {pet.birthday
                ? `Дата рождения: ${fmt(pet.birthday, { day: "numeric", month: "long", year: "numeric" })}`
                : "Дата рождения не указана"}{" "}
              · {pet.sex || "Пол не указан"}
            </p>
            <p>Чип: {pet.chip || "Не указан"}</p>
            <h3>История веса</h3>
            {pet.weights.length ? (
              pet.weights.map((w) => (
                <p key={w.id}>
                  {fmt(w.date)} · {w.value} кг
                </p>
              ))
            ) : (
              <p>Измерений нет.</p>
            )}
            <h3>Медицинские записи</h3>
            {pet.records.length ? (
              pet.records.map((r) => (
                <Card key={r.id}>
                  <strong>
                    {r.type}: {r.name}
                  </strong>
                  <p>{fmt(r.date)}</p>
                  <p className="note">{r.note || "Без заметки"}</p>
                </Card>
              ))
            ) : (
              <p>Записей нет.</p>
            )}
          </>
        );
      case "stock":
        return (
          <Form
            label="Добавить в запас"
            onSave={async (d) =>
              await saved(() =>
                update((p) => ({
                  ...p,
                  stock:
                    Math.round((p.stock + number(d, "amount")) * 1000) / 1000,
                  stockDate: today(),
                })),
              )
            }
          >
            <Field
              label="Добавить, кг"
              name="amount"
              type="number"
              min="0.001"
              max="100"
              step="0.001"
              required
            />
            <p>
              Сейчас {pet.stock} кг. Указанное количество прибавится к остатку.
            </p>
          </Form>
        );
      case "ration":
        return (
          <Form
            onSave={async (d) =>
              await saved(() =>
                update((p) => ({
                  ...p,
                  stock: number(d, "stock"),
                  pack: number(d, "pack"),
                  ration: number(d, "ration"),
                  stockDate: today(),
                })),
              )
            }
          >
            <Field
              label="Фактический остаток, кг"
              name="stock"
              type="number"
              min="0"
              max="1000"
              step="0.001"
              defaultValue={pet.stock}
              required
            />
            <Field
              label="Ваш расход, г/день"
              name="ration"
              type="number"
              min="0"
              max="10000"
              step="1"
              defaultValue={pet.ration}
              required
            />
            <Field
              label="Размер упаковки, кг"
              name="pack"
              type="number"
              min="0.001"
              max="1000"
              step="0.001"
              defaultValue={pet.pack}
              required
            />
            <p className="hint">
              Используем расход только для прогноза. 0 — расход пока не указан.
            </p>
          </Form>
        );
      case "finishShopping": {
        const item = pet.shopping.find((x) => x.id === overlay.itemId);
        if (!item || item.done) return <p role="alert">Покупка уже выполнена или удалена.</p>;
        return (
          <Form label="Подтвердить покупку"
            onSave={async (data) => {
              const raw = text(data, "addedKg");
              const amount = raw ? Number(raw) : 0;
              await saved(() => update((p) => completeShoppingItem(p, item.id, amount, today())));
            }}
          >
            <p><strong>{item.name}</strong>{item.quantity ? " · " + item.quantity : ""}</p>
            <Field label="Сколько корма добавить в запас, кг · необязательно"
              name="addedKg" type="number" min={0} max={100} step={0.001}
              placeholder="Например, 2.5" />
            <p className="hint">Если купили не корм, оставьте поле пустым: покупка отметится выполненной, а запас не изменится. Повторное нажатие не добавит корм дважды.</p>
          </Form>
        );
      }
      case "shopping":
        return (
          <Form
            onSave={async (d) =>
              await saved(() =>
                update((p) => ({
                  ...p,
                  shopping: [
                    ...p.shopping,
                    {
                      id: id(),
                      name: text(d, "name"),
                      quantity: text(d, "quantity"),
                      done: false,
                    },
                  ],
                })),
              )
            }
          >
            <Field label="Что купить?" name="name" required maxLength={120} />
            <Field
              label="Количество"
              name="quantity"
              placeholder="Например, 2 упаковки"
              maxLength={120}
            />
          </Form>
        );
      case "document":
        return (
          <Form
            onSave={async (d) => {
              const file = d.get("file") as File;
              if (
                ![
                  "application/pdf",
                  "image/png",
                  "image/jpeg",
                  "image/webp",
                ].includes(file.type)
              )
                throw new Error("Выберите PDF, PNG, JPEG или WebP");
              if (file.size > 2 * 1024 * 1024)
                throw new Error("Размер файла должен быть не больше 2 МБ");
              const data = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(String(reader.result));
                reader.onerror = () =>
                  reject(new Error("Не удалось прочитать файл"));
                reader.readAsDataURL(file);
              });
              await saved(() =>
                update((p) => ({
                  ...p,
                  documents: [
                    ...p.documents,
                    {
                      id: id(),
                      name: text(d, "name"),
                      filename: file.name,
                      data,
                    },
                  ],
                })),
              );
            }}
          >
            <Field label="Название" name="name" required maxLength={120} />
            <Field
              label="Файл · до 2 МБ"
              name="file"
              type="file"
              accept="application/pdf,image/png,image/jpeg,image/webp"
              required
            />
            <p className="hint">
              Файл сохраняется в вашем аккаунте и входит в резервную копию.
              Доступен активным участникам питомца после входа.
            </p>
          </Form>
        );
      case "backup":
        return (
          <>
            <p>
              Данные сохраняются в вашем аккаунте. Резервная копия включает всех
              питомцев и документы.
            </p>
            <Button onClick={exportData} fullWidth variant="primary">
              <Download />
              Скачать резервную копию
            </Button>
            <Field
              label="Восстановить из копии JSON"
              type="file"
              accept="application/json,.json"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                try {
                  if (file.size > 20 * 1024 * 1024)
                    throw new Error("Копия больше 20 МБ");
                  setRestore(parseBackup(await file.text()));
                  setNotice("Копия проверена. Подтвердите восстановление.");
                } catch {
                  setRestore(null);
                  setNotice(
                    "Копия повреждена или имеет неподдерживаемый формат. Текущие данные сохранены.",
                  );
                }
              }}
            />
            {restore && (
              <Card>
                <h3>Копия проверена</h3>
                <p>
                  {restore.pets.length} питомцев:{" "}
                  {restore.pets.map((p) => p.name).join(", ")}
                </p>
                <p>
                  Восстановление заменит текущие данные всех питомцев. Сначала
                  скачайте текущую копию, если она нужна.
                </p>
                <Button
                  onClick={() =>
                    safe(async () => {
                      await commit(restore);
                      setStorageError("");
                      setRestore(null);
                      setScreen("day");
                      close();
                      setNotice("Данные восстановлены");
                    })
                  }
                  fullWidth
                  variant="destructive"
                >
                  Заменить данные этой копией
                </Button>
                <Button
                  onClick={() => setRestore(null)}
                  fullWidth
                  variant="secondary"
                >
                  Отмена
                </Button>
              </Card>
            )}
          </>
        );
    }
  }
  return (
    <div className="app" aria-busy={busy}>
      <fieldset className="app-fields" disabled={busy}>
        <header className="app-header">
          <span className="brand">
            <PawPrint />
            рядом
          </span>
          <div className="app-header-actions">
            {screen !== "account" && (
              <Button
                onClick={() => setOverlay({ kind: "pets" })}
                className="pet-button"
                variant="secondary"
                aria-label={"Выбрать питомца: " + pet.name}
              >
                <span className="avatar">
                  <Dog />
                </span>
                <span>{pet.name}</span>
                <ChevronDown />
              </Button>
            )}

            {(screen === "account" || screen === "profile") && (
              <IconButton
                label="Назад к планам"
                onClick={() => setScreen("day")}
              >
                <ArrowLeft />
              </IconButton>
            )}
            <IconButton
              label="Аккаунт"
              className="account-trigger"
              aria-current={screen === "account" ? "page" : undefined}
              onClick={() => {
                setScreen("account");
                setNotice("");
                window.scrollTo({ top: 0 });
              }}
            >
              <UserRound />
            </IconButton>
            {state.pets.some((p) => (p.pendingRequests ?? 0) > 0) && (
              <IconButton
                label="Есть запросы на доступ"
                onClick={() => setOverlay({ kind: "pets" })}
              >
                <span className="request-dot" aria-hidden="true">
                  ●
                </span>
              </IconButton>
            )}
          </div>
        </header>
        {pet.demo && (
          <div className="demo-banner">
            Демонстрационный питомец · все данные вымышлены
          </div>
        )}
        {storageError && (
          <div className="notice" role="alert">
            {storageError}
            <Button
              onClick={() => setOverlay({ kind: "backup" })}
              variant="ghost"
            >
              Открыть резервные копии
            </Button>
          </div>
        )}
        <div className="save-status" role="status" aria-live="polite" aria-atomic="true">
          {notice}
        </div>
        <main>
          {screen === "account" && accountContent}
          {screen === "day" && (showFirstPetSetup ? (
            <FirstPetSetup
              onSave={(details) => finishFirstPetSetup(details)}
              onSkip={() => finishFirstPetSetup()}
            />
          ) : (
            <Calendar
              pet={pet}
              selected={selected}
              month={month}
              setSelected={setSelected}
              setMonth={setMonth}
              onAdd={() => setOverlay({ kind: "event" })}
              onTraining={(id) => {
                setOpenTraining(id);
                setScreen("training");
                setNotice("");
                window.scrollTo({ top: 0 });
              }}
              onToggle={toggle}
              onDetail={(event, on) =>
                setOverlay({ kind: "detail", event, on })
              }
            />
          ))}{" "}
          {screen === "training" && (
            <Training
              openSession={openTraining}
              onOpened={() => setOpenTraining(undefined)}
              canEdit={pet.role === "owner" || pet.role === "editor"}
              key={pet.id}
              pet={pet}
              onSave={(next) => update(() => next)}
            />
          )}{" "}
          {screen === "health" && (
            <Health
              pet={pet}
              onWeight={() => setOverlay({ kind: "weight" })}
              onRecord={() => setOverlay({ kind: "record" })}
              onEditWeight={(entryId) => setOverlay({ kind: "editWeight", entryId })}
              onEditRecord={(entryId) => setOverlay({ kind: "editRecord", entryId })}
              onSummary={() => setOverlay({ kind: "summary" })}
              onPlan={(name, linkedRecord) =>
                setOverlay({
                  kind: "event",
                  category: "health",
                  name,
                  linkedRecord,
                })
              }
            />
          )}{" "}
          {screen === "stock" && (
            <Stock
              pet={pet}
              onEdit={() => setOverlay({ kind: "ration" })}
              onAdd={() => setOverlay({ kind: "stock" })}
              onShop={() => setOverlay({ kind: "shopping" })}
              onToggle={(itemId) => {
                const item = pet.shopping.find((s) => s.id === itemId);
                if (!item) return;
                if (!item.done) setOverlay({ kind: "finishShopping", itemId });
                else safe(() => update((p) => restoreShoppingItem(p, itemId)));
              }}
            />
          )}{" "}
          {screen === "profile" && (
            <>
              <div className="profile-hero">
                <span className="avatar">
                  <Dog />
                </span>
                <div>
                  <span className="eyebrow">Мой питомец</span>
                  <h1>{pet.name}</h1>
                  <p>{pet.breed || "Порода не указана"}</p>
                </div>
              </div>
              <Card>
                <dl>
                  <div>
                    <dt>Дата рождения</dt>
                    <dd>
                      {pet.birthday
                        ? fmt(pet.birthday, {
                            day: "numeric",
                            month: "long",
                            year: "numeric",
                          })
                        : "Не указана"}
                    </dd>
                  </div>
                  <div>
                    <dt>Пол</dt>
                    <dd>{pet.sex || "Не указан"}</dd>
                  </div>
                  <div>
                    <dt>Чип</dt>
                    <dd>{pet.chip || "Не указан"}</dd>
                  </div>
                </dl>
                <Button
                  onClick={() => setOverlay({ kind: "editpet" })}
                  fullWidth
                  variant="secondary"
                >
                  Редактировать профиль
                </Button>
              </Card>
              <Card>
                <SectionHeader title="Совместный доступ" compact />
                <p>
                  {pet.role === "editor"
                    ? "У вас совместный доступ к этой карточке."
                    : "Вы владелец этой карточки."}
                </p>
                <Button
                  fullWidth
                  onClick={() => setOverlay({ kind: "sharing" })}
                >
                  Управлять доступом
                  {pet.pendingRequests ? ` · ${pet.pendingRequests}` : ""}
                </Button>
              </Card>
              <SectionHeader title="Документы">
                <Button
                  onClick={() => setOverlay({ kind: "document" })}
                  variant="ghost"
                >
                  Добавить
                </Button>
              </SectionHeader>
              {pet.documents.length ? (
                pet.documents.map((d) => (
                  <Card key={d.id}>
                    <h3>{d.name}</h3>
                    <p className="hint">{d.filename}</p>
                    <a
                      className="text-button"
                      href={d.data}
                      download={d.filename}
                    >
                      Скачать документ
                    </a>
                    <Button size="sm" variant="ghost"
                      onClick={() => setOverlay({ kind: "deleteDocument", entryId: d.id })}>
                      Удалить документ
                    </Button>
                  </Card>
                ))
              ) : (
                <Empty title="Документов пока нет">
                  Добавьте ветпаспорт или результаты обследований.
                </Empty>
              )}
              <Button
                onClick={() => setOverlay({ kind: "pets" })}
                fullWidth
                variant="secondary"
              >
                Все питомцы
              </Button>
              <Button
                onClick={() => setOverlay({ kind: "backup" })}
                fullWidth
                variant="secondary"
              >
                Резервные копии и восстановление
              </Button>
            </>
          )}
        </main>
        {!showFirstPetSetup && <nav className="bottom-nav" aria-label="Разделы приложения">
          {nav.map(([key, label, Icon]) => (
            <Button
              key={key}
              aria-current={screen === key ? "page" : undefined}
              onClick={() => {
                setScreen(key);
                setNotice("");
                window.scrollTo({ top: 0 });
              }}
              variant="ghost"
            >
              <Icon />
              <span>{label}</span>
            </Button>
          ))}
        </nav>}
        {overlay && (
          <Modal title={title} onClose={close}>
            {modalBody()}
          </Modal>
        )}
      </fieldset>
    </div>
  );
}
