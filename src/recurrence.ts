/**
 * Pure, timezone-independent recurrence calculation on calendar dates.
 * ISO dates here are local calendar days, NOT UTC timestamps.
 *
 * Legacy events (daily / weekly without extra fields) keep their old meaning.
 * The count limit refers to original scheduled occurrences, even when an
 * individual occurrence has been moved or cancelled.
 */
export type RepeatFrequency = "once" | "daily" | "weekly" | "monthly" | "yearly";
export type RepeatEndType = "never" | "date" | "count";
export type CalendarException = {
  on: string;
  newDate?: string;
  cancelled?: boolean;
};

export type RecurrenceEvent = {
  date: string;
  repeat: RepeatFrequency;
  end?: string;
  repeatInterval?: number;
  repeatWeekdays?: number[];
  repeatMonthday?: number;
  repeatEndType?: RepeatEndType;
  repeatCount?: number;
  exceptions?: CalendarException[];
};

const DAY_MS = 86400000;
const utcDay = (s: string) => {
  const [y, m, d] = s.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
};
const parts = (s: string) => s.split("-").map(Number);
const diffDays = (from: string, to: string) =>
  Math.round((utcDay(to) - utcDay(from)) / DAY_MS);
const isoDay = (s: string) => {
  const w = new Date(utcDay(s)).getUTCDay();
  return w === 0 ? 7 : w;
};
const endDay = (year: number, month: number) =>
  new Date(Date.UTC(year, month, 0)).getUTCDate();
const intervalOf = (e: RecurrenceEvent) =>
  Number.isSafeInteger(e.repeatInterval) && (e.repeatInterval ?? 0) > 0
    ? e.repeatInterval!
    : 1;
const weekdaysOf = (e: RecurrenceEvent) => {
  const days = e.repeatWeekdays?.length ? e.repeatWeekdays : [isoDay(e.date)];
  return [...new Set(days)].filter((n) => n >= 1 && n <= 7).sort((a, b) => a - b);
};

/** 1-based occurrence number; null means no scheduled occurrence. */
export function occurrenceIndex(e: RecurrenceEvent, on: string): number | null {
  if (on < e.date) return null;
  if (e.repeat === "once") return on === e.date ? 1 : null;
  const step = intervalOf(e);
  const elapsed = diffDays(e.date, on);
  if (e.repeat === "daily") {
    return elapsed % step === 0 ? elapsed / step + 1 : null;
  }
  if (e.repeat === "weekly") {
    const startWeekday = isoDay(e.date);
    const targetWeekday = isoDay(on);
    const weekNumber = Math.floor((elapsed + startWeekday - 1) / 7);
    const weekdays = weekdaysOf(e);
    if (weekNumber % step !== 0 || !weekdays.includes(targetWeekday))
      return null;
    if (weekNumber === 0)
      return weekdays.filter((d) => d >= startWeekday && d <= targetWeekday).length;
    const completeFirstWeek = weekdays.filter((d) => d >= startWeekday).length;
    return (
      completeFirstWeek +
      (weekNumber / step - 1) * weekdays.length +
      weekdays.filter((d) => d <= targetWeekday).length
    );
  }
  const [y0, m0, d0] = parts(e.date);
  const [year, month, day] = parts(on);
  if (e.repeat === "monthly") {
    const months = (year - y0) * 12 + month - m0;
    if (months < 0 || months % step !== 0) return null;
    const target = Math.min(e.repeatMonthday ?? d0, endDay(year, month));
    // When the configured day falls before the series start in its first
    // month, the first real occurrence is in the next interval.
    const originalMonthDay = Math.min(e.repeatMonthday ?? d0, endDay(y0, m0));
    const skippedFirstMonth = originalMonthDay < d0 ? 1 : 0;
    return day === target ? months / step + 1 - skippedFirstMonth : null;
  }
  if (month !== m0 || (year - y0) % step !== 0) return null;
  return day === Math.min(d0, endDay(year, month))
    ? (year - y0) / step + 1
    : null;
}

function permitted(e: RecurrenceEvent, on: string) {
  const index = occurrenceIndex(e, on);
  if (index === null) return false;
  if (e.repeatEndType === "count")
    return index <= (e.repeatCount ?? 0);
  const endsOn =
    e.repeatEndType === "never" ? "" : e.end ?? "";
  return !endsOn || on <= endsOn;
}

/** Resolves single-occurrence exceptions without generating years of rows. */
export function occursOn(e: RecurrenceEvent, day: string): boolean {
  for (const exception of e.exceptions ?? []) {
    if (
      !exception.cancelled &&
      exception.newDate === day &&
      exception.on !== day &&
      permitted(e, exception.on)
    )
      return true;
  }
  if (!permitted(e, day)) return false;
  const exception = e.exceptions?.find((x) => x.on === day);
  return !exception?.cancelled && (!exception?.newDate || exception.newDate === day);
}

export function previousDay(s: string) {
  return new Date(utcDay(s) - DAY_MS).toISOString().slice(0, 10);
}
const plural = (value: number, forms: [string, string, string]) => {
  const last = value % 10;
  const hundreds = value % 100;
  return forms[hundreds >= 11 && hundreds <= 14 ? 2 : last === 1 ? 0 : last >= 2 && last <= 4 ? 1 : 2];
};
export function recurrenceText(e: RecurrenceEvent): string {
  if (e.repeat === "once") return "Однократно";
  const n = intervalOf(e);
  const units: Record<Exclude<RepeatFrequency, "once">, [string, string, string]> = {
    daily: ["день", "дня", "дней"],
    weekly: ["неделю", "недели", "недель"],
    monthly: ["месяц", "месяца", "месяцев"],
    yearly: ["год", "года", "лет"],
  };
  const base = n === 1
    ? { daily: "Каждый день", weekly: "Каждую неделю", monthly: "Каждый месяц", yearly: "Каждый год" }[e.repeat]
    : `Каждые ${n} ${plural(n, units[e.repeat])}`;
  let modifier = "";
  if (e.repeat === "weekly") {
    const names = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"];
    modifier = " · " + weekdaysOf(e).map((d) => names[d - 1]).join(", ");
  } else if (e.repeat === "monthly") {
    const number = e.repeatMonthday ?? Number(e.date.slice(-2));
    modifier = number === 32 ? " · последнее число" : ` · ${number} числа`;
  }
  const ending = e.repeatEndType === "count"
    ? ` · ${e.repeatCount} повторений`
    : e.repeatEndType === "never" || !e.end ? "" : ` · до ${e.end}`;
  return base + modifier + ending;
}
