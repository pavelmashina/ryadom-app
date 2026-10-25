import { describe, expect, it } from "vitest";
import { occursOn, occurrenceIndex, previousDay, recurrenceText, type RecurrenceEvent } from "./recurrence";
import { eventSchema } from "./domain";

const event = (extra: Partial<RecurrenceEvent> = {}): RecurrenceEvent => ({
  date: "2026-01-14", repeat: "once", ...extra,
});

describe("shared calendar recurrence calculations", () => {
  it("does not repeat a single event", () => {
    expect(occursOn(event(), "2026-01-14")).toBe(true);
    expect(occursOn(event(), "2026-01-15")).toBe(false);
  });
  it("respects daily intervals across year and DST boundaries", () => {
    const e = event({ date: "2025-12-31", repeat: "daily", repeatInterval: 3 });
    expect(occursOn(e, "2026-01-03")).toBe(true);
    expect(occursOn(e, "2026-01-02")).toBe(false);
    expect(occursOn(event({ date: "2026-03-27", repeat: "daily" }), "2026-03-29")).toBe(true);
  });
  it("handles every two or four weeks", () => {
    for (const n of [2, 4]) {
      const e = event({ repeat: "weekly", repeatInterval: n });
      const target = new Date(Date.UTC(2026, 0, 14 + n * 7)).toISOString().slice(0, 10);
      expect(occursOn(e, target)).toBe(true);
      expect(occursOn(e, "2026-01-21")).toBe(false);
    }
  });
  it("offers several weekdays in every third week, with correct count", () => {
    const e = event({ date: "2026-01-15", repeat: "weekly", repeatInterval: 3,
      repeatWeekdays: [4, 6], repeatEndType: "count", repeatCount: 3 });
    expect(occurrenceIndex(e, "2026-01-15")).toBe(1);
    expect(occurrenceIndex(e, "2026-01-17")).toBe(2);
    expect(occurrenceIndex(e, "2026-02-05")).toBe(3);
    expect(occursOn(e, "2026-02-07")).toBe(false);
    expect(occursOn(e, "2026-01-16")).toBe(false);
  });
  it("clamps the 31st to the last day of short months and restores the original number", () => {
    const e = event({ date: "2026-01-31", repeat: "monthly" });
    for (const day of ["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]) {
      expect(occursOn(e, day)).toBe(true);
    }
    expect(occursOn(e, "2026-03-30")).toBe(false);
  });
  it("supports the explicit last-day-of-month choice for an event", () => {
    const e = event({ date: "2026-01-15", repeat: "monthly", repeatMonthday: 32 });
    for (const date of ["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"])
      expect(occursOn(e, date)).toBe(true);
    expect(occursOn(e, "2026-03-30")).toBe(false);
    expect(recurrenceText(e)).toContain("последнее число");
    const parsed = eventSchema.safeParse({
      id: "month-last", name: "Проверка", category: "care",
      date: "2026-01-15", time: "", repeat: "monthly",
      repeatInterval: 1, repeatMonthday: 32, repeatEndType: "never",
      end: "", reminder: "0", note: "",
    });
    expect(parsed.success).toBe(true);
  });
  it("handles leap years when clamping February", () => {
    const e = event({ date: "2024-01-31", repeat: "monthly" });
    expect(occursOn(e, "2024-02-29")).toBe(true);
  });
  it("handles interval 3 monthly on day 14", () => {
    const e = event({ repeat: "monthly", repeatInterval: 3, repeatMonthday: 14 });
    expect(occursOn(e, "2026-01-14")).toBe(true);
    expect(occursOn(e, "2026-04-14")).toBe(true);
    expect(occursOn(e, "2026-07-14")).toBe(true);
    expect(occursOn(e, "2026-02-14")).toBe(false);
  });
  it("counted monthly occurrences start at the first eligible date, not an earlier day", () => {
    const e = event({ date: "2026-01-20", repeat: "monthly",
      repeatMonthday: 14, repeatEndType: "count", repeatCount: 2 });
    expect(occursOn(e, "2026-01-14")).toBe(false);
    expect(occurrenceIndex(e, "2026-02-14")).toBe(1);
    expect(occursOn(e, "2026-02-14")).toBe(true);
    expect(occursOn(e, "2026-03-14")).toBe(true);
    expect(occursOn(e, "2026-04-14")).toBe(false);
  });
  it("honors end date inclusively", () => {
    const e = event({ repeat: "daily", repeatEndType: "date", end: "2026-01-17" });
    expect(occursOn(e, "2026-01-17")).toBe(true);
    expect(occursOn(e, "2026-01-18")).toBe(false);
  });
  it("honors occurrence count with irregular weekday rules", () => {
    const e = event({ repeat: "weekly", repeatWeekdays: [3, 5],
      repeatEndType: "count", repeatCount: 4 });
    expect(occursOn(e, "2026-01-23")).toBe(true);
    expect(occursOn(e, "2026-01-28")).toBe(false);
  });
  it("repeats indefinitely when no limit was set", () => {
    expect(occursOn(event({ repeat: "yearly" }), "2046-01-14")).toBe(true);
  });
  it("clamps yearly leap-day anniversary to February 28", () => {
    expect(occursOn(event({ date: "2024-02-29", repeat: "yearly" }), "2025-02-28")).toBe(true);
    expect(occursOn(event({ date: "2024-02-29", repeat: "yearly" }), "2028-02-29")).toBe(true);
  });
  it("cancels a single occurrence without shifting the rest", () => {
    const e = event({ repeat: "monthly", exceptions: [{ on: "2026-02-14", cancelled: true }] });
    expect(occursOn(e, "2026-02-14")).toBe(false);
    expect(occursOn(e, "2026-03-14")).toBe(true);
  });
  it("moves only one occurrence without creating a second instance", () => {
    const e = event({ repeat: "monthly", exceptions: [{ on: "2026-02-14", newDate: "2026-02-16" }] });
    expect(occursOn(e, "2026-02-14")).toBe(false);
    expect(occursOn(e, "2026-02-16")).toBe(true);
    expect(occursOn(e, "2026-03-14")).toBe(true);
  });
  it("a cancelled occurrence consumes one of the count-limited occurrences", () => {
    const e = event({ repeat: "monthly", repeatEndType: "count", repeatCount: 2,
      exceptions: [{ on: "2026-01-14", cancelled: true }] });
    expect(occursOn(e, "2026-02-14")).toBe(true);
    expect(occursOn(e, "2026-03-14")).toBe(false);
  });
  it("keeps legacy events and comment schema valid", () => {
    expect(eventSchema.safeParse({
      id:"old", name:"Old", category:"care", date:"2026-01-14", time:"",
      repeat:"weekly", end:"", reminder:"15", note:"Old comment",
    }).success).toBe(true);
  });
  it("formats readable recurrence and maintains previous day boundaries", () => {
    expect(recurrenceText(event({ repeat: "monthly", repeatInterval: 3, repeatMonthday:14 })))
      .toContain("3 месяца");
    expect(previousDay("2026-03-01")).toBe("2026-02-28");
  });
});
