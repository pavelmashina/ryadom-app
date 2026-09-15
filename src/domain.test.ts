import { describe, it, expect } from "vitest";
import {
  occurs,
  mastery,
  sessionSchema,
  eventSchema,
  blankPet,
  completionKey,
  moveEvent,
  stateSchema,
  type PetEvent,
  type Session,
} from "./domain";
const event = (overrides: Partial<PetEvent> = {}): PetEvent => ({
  id: "event",
  name: "Уход",
  date: "2026-01-31",
  time: "",
  repeat: "once",
  end: "",
  reminder: "0",
  note: "",
  category: "care",
  ...overrides,
});
const session = (
  good: number,
  total: number,
  overrides: Partial<Session> = {},
): Session => ({
  id: crypto.randomUUID(),
  command: "sit",
  date: "2026-01-01",
  good,
  total,
  minutes: 5,
  note: "",
  ...overrides,
});
describe("Calendar recurrence", () => {
  it("single events occur only on their own date", () => {
    expect(occurs(event(), "2026-01-31")).toBe(true);
    expect(occurs(event(), "2026-02-01")).toBe(false);
  });
  it("daily events cross month/year boundaries and respect inclusive end", () => {
    const e = event({ date: "2025-12-31", repeat: "daily", end: "2026-02-01" });
    expect(occurs(e, "2025-12-30")).toBe(false);
    expect(occurs(e, "2026-01-01")).toBe(true);
    expect(occurs(e, "2026-02-01")).toBe(true);
    expect(occurs(e, "2026-02-02")).toBe(false);
  });
  it("weekly repeats cross leap days and honor end", () => {
    const e = event({
      date: "2024-02-22",
      repeat: "weekly",
      end: "2024-03-07",
    });
    expect(occurs(e, "2024-02-29")).toBe(true);
    expect(occurs(e, "2024-03-01")).toBe(false);
    expect(occurs(e, "2024-03-07")).toBe(true);
    expect(occurs(e, "2024-03-14")).toBe(false);
  });
  it("weekly recurrence uses calendar days across daylight saving transitions", () => {
    expect(
      occurs(event({ date: "2026-03-01", repeat: "weekly" }), "2026-03-08"),
    ).toBe(true);
    expect(
      occurs(event({ date: "2026-10-25", repeat: "weekly" }), "2026-11-01"),
    ).toBe(true);
  });
  it("validates dates and repeat end", () => {
    expect(eventSchema.safeParse(event({ date: "2026-02-30" })).success).toBe(
      false,
    );
    expect(eventSchema.safeParse(event({ end: "2026-01-30" })).success).toBe(
      false,
    );
  });
  it("completion belongs to an occurrence; moving clears old completion key", () => {
    const p = blankPet("Pet");
    const e = event();
    p.events = [e];
    p.done[completionKey(e, e.date)] = false;
    const moved = moveEvent(p, e.id, "2026-02-02");
    expect(moved.events[0].date).toBe("2026-02-02");
    expect(moved.done[completionKey(e, e.date)]).toBeUndefined();
    expect(completionKey(e, "2026-01-31")).not.toBe(
      completionKey(e, "2026-02-01"),
    );
  });
  it("refuses moving completed or repeating events", () => {
    const p = blankPet("Pet");
    p.events = [event()];
    p.done["event:2026-01-31"] = true;
    expect(() => moveEvent(p, "event", "2026-02-02")).toThrow();
    p.events = [event({ repeat: "daily" })];
    p.done = {};
    expect(() => moveEvent(p, "event", "2026-02-02")).toThrow();
  });
});
describe("Mastery product rule", () => {
  it("has no score without observations", () => {
    expect(mastery([], "sit")).toMatchObject({
      percent: null,
      label: "Ещё не оценено",
      total: 0,
    });
    expect(
      mastery([session(1, 1, { command: "other" })], "sit").percent,
    ).toBeNull();
  });
  it.each([
    [0, "Начинает понимать"],
    [39, "Начинает понимать"],
    [40, "Пока нестабильно"],
    [69, "Пока нестабильно"],
    [70, "Выполняет уверенно"],
    [89, "Выполняет уверенно"],
    [90, "Хорошо усвоено"],
    [100, "Хорошо усвоено"],
  ])("labels %s percent correctly", (n, label) => {
    expect(mastery([session(n as number, 100)], "sit").label).toBe(label);
  });
  it("weights by repetitions instead of averaging percentages", () => {
    expect(mastery([session(1, 1), session(0, 9)], "sit").percent).toBe(10);
  });
  it("uses latest five by date; last entered breaks same-day ties", () => {
    const list = Array.from({ length: 6 }, (_, i) =>
      session(i === 0 ? 0 : 10, 10, { date: `2026-01-0${i + 1}` }),
    );
    expect(mastery(list.reverse(), "sit").percent).toBe(100);
    expect(
      mastery(
        [session(0, 10), ...Array.from({ length: 5 }, () => session(10, 10))],
        "sit",
      ).percent,
    ).toBe(100);
  });
  it("marks scarce evidence as preliminary including a single perfect attempt", () => {
    expect(mastery([session(1, 1)], "sit")).toMatchObject({
      percent: 100,
      preliminary: true,
    });
    expect(mastery([session(5, 5), session(5, 5)], "sit").preliminary).toBe(
      true,
    );
    expect(
      mastery([session(1, 1), session(1, 1), session(1, 1)], "sit").preliminary,
    ).toBe(true);
    expect(
      mastery([session(3, 3), session(3, 3), session(4, 4)], "sit").preliminary,
    ).toBe(false);
  });
  it("rounds consistently at displayed boundaries", () => {
    expect(mastery([session(395, 1000)], "sit")).toMatchObject({
      percent: 40,
      label: "Пока нестабильно",
    });
  });
  it.each([
    [6, 5],
    [0, 0],
    [-1, 5],
    [1.5, 5],
    [1, 2.5],
    [NaN, 5],
  ])("rejects invalid success/total %s/%s", (good, total) => {
    expect(sessionSchema.safeParse(session(good, total)).success).toBe(false);
  });
  it("accepts zero success and equal success/total", () => {
    expect(sessionSchema.safeParse(session(0, 1)).success).toBe(true);
    expect(sessionSchema.safeParse(session(5, 5)).success).toBe(true);
  });
  it("isolates pets and rejects orphan sessions in a backup", () => {
    const a = blankPet("A"),
      b = blankPet("B");
    a.commands.push({ id: "sit", name: "Sit" });
    expect(b.commands).toHaveLength(0);
    b.sessions = [session(1, 1)];
    expect(
      stateSchema.safeParse({ version: 1, selectedPet: a.id, pets: [a, b] })
        .success,
    ).toBe(false);
  });
});
