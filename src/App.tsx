import { useState } from "react";
import {
  PawPrint,
  Dog,
  ChevronDown,
  CalendarDays,
  HeartPulse,
  GraduationCap,
  Package,
  Download,
} from "lucide-react";
import Calendar from "./Calendar";
import Training from "./Training";
import Health from "./Health";
import Stock from "./Stock";
import EventForm from "./EventForm";
import {
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
import {
  loadState,
  saveState,
  parseBackup,
  download,
  STORAGE_KEY,
} from "./storage";
type Screen = "day" | "health" | "training" | "stock" | "profile";
type Overlay =
  | {
      kind: "event";
      category?: PetEvent["category"];
      name?: string;
      linkedRecord?: string;
    }
  | { kind: "detail"; event: PetEvent; on: string }
  | { kind: "session"; command: string }
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
export default function App() {
  const [loaded] = useState(loadState);
  const [state, setState] = useState(loaded.state),
    [storageError, setStorageError] = useState(loaded.error),
    [notice, setNotice] = useState(""),
    [screen, setScreen] = useState<Screen>("day"),
    [overlay, setOverlay] = useState<Overlay | null>(null),
    [selected, setSelected] = useState(today()),
    [month, setMonth] = useState(today().slice(0, 7) + "-01"),
    [restore, setRestore] = useState<State | null>(null);
  const pet = state.pets.find((p) => p.id === state.selectedPet)!;
  function commit(next: State) {
    if (loaded.error && storageError)
      throw new Error("Сначала восстановите данные в разделе резервных копий.");
    try {
      saveState(next);
    } catch {
      setStorageError(
        "Не удалось сохранить данные: хранилище браузера недоступно или заполнено. Изменение не применено. Сохраните резервную копию.",
      );
      throw new Error(
        "Данные не сохранены. Возможно, хранилище заполнено — уменьшите размер документов.",
      );
    }
    setState(next);
    setStorageError("");
    setNotice("Сохранено на этом устройстве");
  }
  function update(fn: (p: Pet) => Pet) {
    commit({
      ...state,
      pets: state.pets.map((p) =>
        p.id === pet.id ? petSchema.parse(fn(p)) : p,
      ),
    });
  }
  function safe(fn: () => void) {
    try {
      fn();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Не удалось сохранить");
    }
  }
  function close() {
    setOverlay(null);
  }
  function saved(fn: () => void) {
    fn();
    close();
  }
  function addEvent(e: PetEvent) {
    saved(() => update((p) => ({ ...p, events: [...p.events, e] })));
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
    safe(() => {
      commit({ ...state, selectedPet: p.id });
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
            <button className="primary" onClick={() => toggle(e, overlay.on)}>
              {done ? "Снять отметку о выполнении" : "Отметить выполненным"}
            </button>
            {e.repeat === "once" && !done && (
              <Form
                label="Перенести"
                onSave={(d) => {
                  const to = text(d, "date");
                  saved(() => update((p) => moveEvent(p, e.id, to)));
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
              <button className="pet-row" key={p.id} onClick={() => choose(p)}>
                <span className="avatar">
                  <Dog />
                </span>
                <span>
                  <strong>{p.name}</strong>
                  <small>
                    {p.demo
                      ? "Демонстрационные данные"
                      : p.id === pet.id
                        ? "Выбран сейчас"
                        : "Отдельные календарь и история"}
                  </small>
                </span>
                {p.id === pet.id ? "✓" : "→"}
              </button>
            ))}
            <button
              className="primary"
              onClick={() => setOverlay({ kind: "newpet" })}
            >
              Добавить питомца
            </button>
            <button
              className="secondary"
              onClick={() => {
                close();
                setScreen("profile");
              }}
            >
              Профиль · {pet.name}
            </button>
            {!state.pets.some((p) => p.demo) && (
              <button
                className="text-button"
                onClick={() =>
                  safe(() => {
                    const p = demoPet();
                    commit({
                      ...state,
                      pets: [...state.pets, p],
                      selectedPet: p.id,
                    });
                    close();
                    setScreen("day");
                  })
                }
              >
                Открыть отдельный демонстрационный пример
              </button>
            )}
          </>
        );
      case "newpet":
        return (
          <Form
            onSave={(d) => {
              const p = blankPet(text(d, "name"));
              petSchema.parse(p);
              saved(() =>
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
            onSave={(d) =>
              saved(() =>
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
            onSave={(d) => {
              const name = text(d, "name");
              if (!name) throw new Error("Введите название команды");
              if (
                pet.commands.some(
                  (c) => c.name.toLowerCase() === name.toLowerCase(),
                )
              )
                throw new Error("Такая команда уже есть");
              saved(() =>
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
            onSave={(d) => {
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
              saved(() =>
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
            onSave={(d) =>
              saved(() =>
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
            onSave={(d) =>
              saved(() =>
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
            onSave={(d) =>
              saved(() =>
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
            onSave={(d) =>
              saved(() =>
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
            onSave={(d) =>
              saved(() =>
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
              saved(() =>
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
              Файл хранится в этом браузере и входит в резервную копию. Место
              ограничено; облачного хранения нет.
            </p>
          </Form>
        );
      case "backup":
        return (
          <>
            <p>
              Данные сохраняются только в этом браузере. Резервная копия
              включает всех питомцев и документы.
            </p>
            <button className="primary" onClick={exportData}>
              <Download size={18} />
              Скачать резервную копию
            </button>
            {loaded.error && (
              <button
                className="secondary"
                onClick={() =>
                  download(
                    "ryadom-unreadable-backup.json",
                    localStorage.getItem(STORAGE_KEY) || "",
                  )
                }
              >
                Скачать исходные непрочитанные данные
              </button>
            )}
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
                <button
                  className="primary"
                  onClick={() =>
                    safe(() => {
                      saveState(restore);
                      setState(restore);
                      setStorageError("");
                      setRestore(null);
                      setScreen("day");
                      close();
                      setNotice("Данные восстановлены");
                    })
                  }
                >
                  Заменить данные этой копией
                </button>
                <button className="secondary" onClick={() => setRestore(null)}>
                  Отмена
                </button>
              </Card>
            )}
          </>
        );
    }
  }
  return (
    <div className="app">
      <header>
        <span className="brand">
          <PawPrint size={25} />
          рядом
        </span>
        <button
          className="pet-button"
          onClick={() => setOverlay({ kind: "pets" })}
        >
          <span className="avatar">
            <Dog size={21} />
          </span>
          <span>{pet.name}</span>
          <ChevronDown size={16} />
        </button>
      </header>
      {pet.demo && (
        <div className="demo-banner">
          Демонстрационный питомец · все данные вымышлены
        </div>
      )}
      {storageError && (
        <div className="notice" role="alert">
          {storageError}
          <button
            className="text-button"
            onClick={() => setOverlay({ kind: "backup" })}
          >
            Открыть резервные копии
          </button>
        </div>
      )}
      <div className="save-status" role="status" aria-live="polite">
        {notice || "Данные хранятся на этом устройстве"}
      </div>
      <main>
        {screen === "day" && (
          <Calendar
            pet={pet}
            selected={selected}
            month={month}
            setSelected={setSelected}
            setMonth={setMonth}
            onAdd={() => setOverlay({ kind: "event" })}
            onToggle={toggle}
            onDetail={(event, on) => setOverlay({ kind: "detail", event, on })}
          />
        )}{" "}
        {screen === "training" && (
          <Training
            pet={pet}
            onCommand={() => setOverlay({ kind: "command" })}
            onSession={(command) => setOverlay({ kind: "session", command })}
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
                <Dog size={38} />
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
              <button
                className="secondary"
                onClick={() => setOverlay({ kind: "editpet" })}
              >
                Редактировать профиль
              </button>
            </Card>
            <div className="section-title">
              <h2>Документы</h2>
              <button
                className="text-button"
                onClick={() => setOverlay({ kind: "document" })}
              >
                Добавить
              </button>
            </div>
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
            <button
              className="secondary"
              onClick={() => setOverlay({ kind: "pets" })}
            >
              Все питомцы
            </button>
            <button
              className="secondary"
              onClick={() => setOverlay({ kind: "backup" })}
            >
              Резервные копии и восстановление
            </button>
          </>
        )}
      </main>
      <nav aria-label="Разделы приложения">
        {nav.map(([key, label, Icon]) => (
          <button
            key={key}
            aria-current={screen === key ? "page" : undefined}
            onClick={() => {
              setScreen(key);
              setNotice("");
              window.scrollTo({ top: 0 });
            }}
          >
            <Icon size={22} />
            <span>{label}</span>
          </button>
        ))}
      </nav>
      {overlay && (
        <Modal title={title} onClose={close}>
          {modalBody()}
        </Modal>
      )}
    </div>
  );
}
