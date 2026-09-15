import { z } from "zod";
export const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const today = () => iso(new Date());
export const date = (s: string) => new Date(`${s}T12:00:00`);
export const fmt = (
  s: string,
  options: Intl.DateTimeFormatOptions = { day: "numeric", month: "long" },
) => date(s).toLocaleDateString("ru-RU", options);
export const id = () => crypto.randomUUID();
const daySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (s) => !Number.isNaN(date(s).valueOf()) && iso(date(s)) === s,
    "Некорректная дата",
  );
const nameSchema = z.string().trim().min(1, "Введите название").max(120);
export const eventSchema = z
  .object({
    id: z.string(),
    name: nameSchema,
    category: z.enum(["health", "training", "care"]),
    date: daySchema,
    time: z.string().regex(/^$|^([01]\d|2[0-3]):[0-5]\d$/),
    repeat: z.enum(["once", "daily", "weekly"]),
    end: z.union([z.literal(""), daySchema]),
    reminder: z.enum(["0", "15", "60", "1440"]),
    note: z.string().max(5000),
    linkedRecord: z.string().optional(),
  })
  .refine(
    (e) => !e.end || e.end >= e.date,
    "Окончание должно быть не раньше начала",
  );
export type PetEvent = z.infer<typeof eventSchema>;
export const sessionSchema = z
  .object({
    id: z.string(),
    command: z.string(),
    date: daySchema,
    good: z.number().int().min(0).max(1000),
    total: z.number().int().min(1).max(1000),
    minutes: z.number().int().min(1).max(600),
    note: z.string().max(5000),
  })
  .refine(
    (s) => s.good <= s.total,
    "Успешных повторов не может быть больше общего числа",
  );
export type Session = z.infer<typeof sessionSchema>;
const docSchema = z.object({
  id: z.string(),
  name: nameSchema,
  data: z
    .string()
    .max(2800000)
    .refine((s) =>
      /^data:(application\/pdf|image\/(png|jpeg|webp));base64,[A-Za-z0-9+/=]+$/.test(
        s,
      ),
    ),
  filename: z.string(),
});
export const petSchema = z.object({
  id: z.string(),
  name: nameSchema,
  demo: z.boolean(),
  breed: z.string(),
  birthday: z.union([z.literal(""), daySchema]),
  sex: z.enum(["", "Девочка", "Мальчик"]),
  chip: z.string(),
  events: z.array(eventSchema),
  done: z.record(z.boolean()),
  commands: z.array(z.object({ id: z.string(), name: nameSchema })),
  sessions: z.array(sessionSchema),
  weights: z.array(
    z.object({
      id: z.string(),
      date: daySchema,
      value: z.number().positive().max(300),
    }),
  ),
  records: z.array(
    z.object({
      id: z.string(),
      date: daySchema,
      name: nameSchema,
      type: z.enum(["Визит", "Анализы / УЗИ", "Прививка", "Назначение"]),
      note: z.string(),
    }),
  ),
  stock: z.number().min(0).max(1000),
  pack: z.number().positive().max(1000),
  ration: z.number().min(0).max(10000),
  stockDate: z.union([z.literal(""), daySchema]),
  shopping: z.array(
    z.object({
      id: z.string(),
      name: nameSchema,
      quantity: z.string(),
      done: z.boolean(),
    }),
  ),
  documents: z.array(docSchema),
});
export type Pet = z.infer<typeof petSchema>;
export const stateSchema = z
  .object({
    version: z.literal(1),
    selectedPet: z.string(),
    pets: z.array(petSchema).min(1),
  })
  .superRefine((s, ctx) => {
    if (
      !s.pets.some((p) => p.id === s.selectedPet) ||
      new Set(s.pets.map((p) => p.id)).size !== s.pets.length
    )
      ctx.addIssue({ code: "custom", message: "Некорректные питомцы" });
    for (const p of s.pets) {
      if (p.sessions.some((s) => !p.commands.some((c) => c.id === s.command)))
        ctx.addIssue({ code: "custom", message: "Занятие без команды" });
    }
  });
export type State = z.infer<typeof stateSchema>;
export const blankPet = (name: string): Pet => ({
  id: id(),
  name,
  demo: false,
  breed: "",
  birthday: "",
  sex: "",
  chip: "",
  events: [],
  done: {},
  commands: [],
  sessions: [],
  weights: [],
  records: [],
  stock: 0,
  pack: 3,
  ration: 0,
  stockDate: "",
  shopping: [],
  documents: [],
});
export const initialState = (): State => {
  const p = blankPet("Масюша");
  return { version: 1, selectedPet: p.id, pets: [p] };
};
export function occurs(e: PetEvent, s: string) {
  if (s < e.date || (e.end && s > e.end)) return false;
  if (e.repeat === "once") return s === e.date;
  if (e.repeat === "daily") return true;
  const utc = (s: string) => {
    const [y, m, d] = s.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return ((utc(s) - utc(e.date)) / 86400000) % 7 === 0;
}
export const eventsFor = (p: Pet, s: string) =>
  p.events
    .filter((e) => occurs(e, s))
    .sort((a, b) => a.time.localeCompare(b.time));
export const completionKey = (e: PetEvent, s: string) => `${e.id}:${s}`;
export function moveEvent(p: Pet, eventId: string, to: string): Pet {
  daySchema.parse(to);
  const e = p.events.find((e) => e.id === eventId);
  if (!e || e.repeat !== "once" || p.done[completionKey(e, e.date)])
    throw new Error("Можно перенести только незавершённое разовое событие");
  const done = { ...p.done };
  delete done[completionKey(e, e.date)];
  return {
    ...p,
    done,
    events: p.events.map((x) =>
      x.id === eventId ? { ...x, date: to, end: "" } : x,
    ),
  };
}
export const MASTERY_RULE = {
  window: 5,
  minSessions: 3,
  minRepeats: 10,
} as const;
export function mastery(sessions: Session[], command: string) {
  const recent = sessions
    .map((s, i) => ({ ...s, index: i }))
    .filter((s) => s.command === command)
    .sort((a, b) => b.date.localeCompare(a.date) || b.index - a.index)
    .slice(0, MASTERY_RULE.window);
  const total = recent.reduce((v, s) => v + s.total, 0),
    good = recent.reduce((v, s) => v + s.good, 0);
  const percent = total ? Math.round((good / total) * 100) : null;
  return {
    recent,
    total,
    good,
    percent,
    preliminary:
      recent.length < MASTERY_RULE.minSessions ||
      total < MASTERY_RULE.minRepeats,
    label:
      percent === null
        ? "Ещё не оценено"
        : percent < 40
          ? "Начинает понимать"
          : percent < 70
            ? "Пока нестабильно"
            : percent < 90
              ? "Выполняет уверенно"
              : "Хорошо усвоено",
  };
}
export function demoPet(): Pet {
  const p = blankPet("Бублик · пример");
  p.demo = true;
  const c = id();
  p.commands = [
    { id: c, name: "Ко мне" },
    { id: id(), name: "Сидеть" },
    { id: id(), name: "Место" },
  ];
  p.sessions = [
    {
      id: id(),
      command: c,
      date: today(),
      good: 7,
      total: 10,
      minutes: 5,
      note: "Демонстрационный результат",
    },
  ];
  p.events = [
    {
      id: id(),
      name: "Утренняя прогулка",
      category: "care",
      date: today(),
      time: "08:00",
      repeat: "daily",
      end: "",
      reminder: "0",
      note: "Пример расписания",
    },
    {
      id: id(),
      name: "Повторить «Ко мне»",
      category: "training",
      date: today(),
      time: "18:30",
      repeat: "weekly",
      end: "",
      reminder: "15",
      note: "Демонстрационное событие",
    },
  ];
  p.stock = 1.2;
  p.ration = 200;
  p.stockDate = today();
  return p;
}
