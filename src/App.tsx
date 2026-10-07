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
import { useRef, useState, type ReactNode } from "react";
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
type Screen = "day" | "health" | "training" | "stock" | "profile" | "account";
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
      kind:
        | "pets"
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
}: {
  initial: State;
  onPersist: (next: State) => Promise<State>;
  accountContent: ReactNode;
}) {
  const loaded = { state: initial, error: "" };
  const saving = useRef(false);
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
  async function commit(next: State) {
    if (saving.current) throw new Error("Дождитесь завершения сохранения");
    saving.current = true;
    setBusy(true);
    try {
      const stored = await onPersist(next);
      setState(stored);
      setStorageError("");
      setNotice("Сохранено в облаке");
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Не удалось сохранить");
      throw e;
    } finally {
      saving.current = false;
      setBusy(false);
    }
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
    setSelected(e.date);
    setMonth(e.date.slice(0, 7) + "-01");
    setScreen("day");
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
        : overlay?.kind === "session"
          ? `Занятие · ${pet.commands.find((c) => c.id === overlay.command)?.name}`
          : (
              {
                pets: "Мои питомцы",
                newpet: "Новый питомец",
                editpet: "Данные питомца",
                command: "Новая команда",
                weight: "Записать вес",
                record: "Медицинская запись",
                summary: "Сводка для ветеринара",
                stock: "Пополнить корм",
                ration: "Расход и остаток",
                shopping: "Новая покупка",
                document: "Добавить документ",
                backup: "Резервные копии",
              } as Record<string, string>
            )[overlay?.kind || ""];
  function modalBody() {
    if (!overlay) return null;
    switch (overlay.kind) {
      case "event":
        return (
          <EventForm
            selected={selected}
            category={overlay.category}
            name={overlay.name}
            linkedRecord={overlay.linkedRecord}
            onSave={addEvent}
          />
        );
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
              <p>
                {
                  {
                    once: "Однократно",
                    daily: "Каждый день",
                    weekly: "Каждую неделю",
                  }[e.repeat]
                }
                {e.end ? ` · по ${fmt(e.end)}` : ""}
              </p>
              <p className="note">{e.note || "Заметка не добавлена"}</p>
              <p className="hint">
                Напоминание:{" "}
                {e.reminder === "0"
                  ? "выключено"
                  : `за ${e.reminder} мин · только настройка, доставка не подключена`}
              </p>
            </Card>
            <Button
              onClick={() => toggle(e, overlay.on)}
              fullWidth
              variant="primary"
            >
              {done ? "Снять отметку о выполнении" : "Отметить выполненным"}
            </Button>
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
        return (
          <Form
            onSave={async (d) =>
              await saved(() =>
                update((p) => ({
                  ...p,
                  weights: [
                    ...p.weights,
                    {
                      id: id(),
                      date: text(d, "date"),
                      value: number(d, "value"),
                    },
                  ],
                })),
              )
            }
          >
            <Field
              label="Вес, кг"
              name="value"
              type="number"
              min="0.01"
              max="300"
              step="0.01"
              required
            />
            <Field
              label="Дата измерения"
              name="date"
              type="date"
              defaultValue={today()}
              max={today()}
              required
            />
          </Form>
        );
      case "record":
        return (
          <Form
            onSave={async (d) =>
              await saved(() =>
                update((p) => ({
                  ...p,
                  records: [
                    ...p.records,
                    {
                      id: id(),
                      name: text(d, "name"),
                      date: text(d, "date"),
                      type: text(d, "type") as Pet["records"][number]["type"],
                      note: text(d, "note"),
                    },
                  ],
                })),
              )
            }
          >
            <Select label="Тип записи" name="type">
              {["Визит", "Анализы / УЗИ", "Прививка", "Назначение"].map((x) => (
                <option key={x}>{x}</option>
              ))}
            </Select>
            <Field label="Название" name="name" required maxLength={120} />
            <Field
              label="Дата"
              name="date"
              type="date"
              defaultValue={today()}
              max={today()}
              required
            />
            <Note label="Результат или назначение" />
            <p className="hint">
              После сохранения запись можно связать с новым событием. Файлы
              добавляются в документы профиля.
            </p>
          </Form>
        );
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
              Доступен только вам после входа.
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
        <div className="save-status" role="status" aria-live="polite">
          {notice}
        </div>
        <main>
          {screen === "account" && accountContent}
          {screen === "day" && (
            <Calendar
              pet={pet}
              selected={selected}
              month={month}
              setSelected={setSelected}
              setMonth={setMonth}
              onAdd={() => setOverlay({ kind: "event" })}
              onToggle={toggle}
              onDetail={(event, on) =>
                setOverlay({ kind: "detail", event, on })
              }
            />
          )}{" "}
          {screen === "training" && (
            <Training
              key={pet.id}
              pet={pet}
              onSave={(next) => update(() => next)}
              onPlan={(name) =>
                setOverlay({ kind: "event", category: "training", name })
              }
            />
          )}{" "}
          {screen === "health" && (
            <Health
              pet={pet}
              onWeight={() => setOverlay({ kind: "weight" })}
              onRecord={() => setOverlay({ kind: "record" })}
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
              onToggle={(item) =>
                safe(() =>
                  update((p) => ({
                    ...p,
                    shopping: p.shopping.map((s) =>
                      s.id === item ? { ...s, done: !s.done } : s,
                    ),
                  })),
                )
              }
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
        <nav className="bottom-nav" aria-label="Разделы приложения">
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
        </nav>
        {overlay && (
          <Modal title={title} onClose={close}>
            {modalBody()}
          </Modal>
        )}
      </fieldset>
    </div>
  );
}
