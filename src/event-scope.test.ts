import { describe, expect, it } from "vitest";
import { blankPet, eventInstance, eventSchema, eventsFor, stateSchema, type Pet, type PetEvent } from "./domain";
import { occursOn } from "./recurrence";
import { sharedChanges } from "./cloud-data";
import {
  deleteFollowing, deleteOccurrence, editAll, editOccurrence,
  followingSource, singleOccurrenceSource, splitSeries,
} from "./event-scope";

const series = (fields: Partial<PetEvent> = {}): PetEvent => ({
  id: "11111111-1111-4111-8111-111111111111",
  name: "Груминг", category: "care", date: "2026-10-05", time: "18:00",
  repeat: "weekly", end: "", reminder: "0", note: "",
  ...fields,
});
const petWith = (e: PetEvent, done: Record<string, boolean> = {}): Pet => ({ ...blankPet("Тест"), events: [e], done });
const showDays = (events: PetEvent[], from: string, to: string) => {
  const out: string[] = [];
  for (let d = new Date(from + "T00:00:00Z"); d <= new Date(to + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + 1)) {
    const day = d.toISOString().slice(0, 10);
    for (const e of events) if (occursOn(e, day)) out.push(day);
  }
  return out;
};

describe("«Только это событие» is an override of the series", () => {
  it("keeps the series ID, stores only changed fields and shows them on that day", () => {
    const e = series();
    const next = { ...singleOccurrenceSource(e, "2026-10-12"), name: "Груминг у мастера", time: "10:00" };
    const p = editOccurrence(petWith(e), e, "2026-10-12", next);
    expect(p.events).toHaveLength(1);
    expect(p.events[0]).toMatchObject({ id: e.id, name: "Груминг", time: "18:00" });
    expect(p.events[0].exceptions).toEqual([{ on: "2026-10-12", name: "Груминг у мастера", time: "10:00" }]);
    expect(eventsFor(p, "2026-10-12")[0]).toMatchObject({ id: e.id, name: "Груминг у мастера", time: "10:00" });
    expect(eventsFor(p, "2026-10-19")[0]).toMatchObject({ name: "Груминг", time: "18:00" });
  });

  it("moves an occurrence with its completion mark and edits it again by its scheduled day", () => {
    const e = series();
    const moved = editOccurrence(petWith(e, { [`${e.id}:2026-10-12`]: true }), e, "2026-10-12",
      { ...singleOccurrenceSource(e, "2026-10-12"), date: "2026-10-14" });
    expect(moved.done).toEqual({ [`${e.id}:2026-10-14`]: true });
    expect(showDays(moved.events, "2026-10-10", "2026-10-16")).toEqual(["2026-10-14"]);
    // Opening the moved occurrence (shown on 14th) and editing it again:
    const current = moved.events[0];
    const again = editOccurrence(moved, current, "2026-10-14",
      { ...singleOccurrenceSource(current, "2026-10-14"), note: "Взять полотенце" });
    expect(again.events[0].exceptions).toEqual([{ on: "2026-10-12", newDate: "2026-10-14", note: "Взять полотенце" }]);
    expect(eventInstance(again.events[0], "2026-10-14").note).toBe("Взять полотенце");
  });

  it("removes the exception when the occurrence is edited back to the series values", () => {
    const e = series({ exceptions: [{ on: "2026-10-12", time: "10:00" }] });
    const p = editOccurrence(petWith(e), e, "2026-10-12", { ...singleOccurrenceSource(e, "2026-10-12"), time: "18:00" });
    expect(p.events[0].exceptions).toBeUndefined();
  });
});

describe("«Это и последующие» splits the series at the boundary", () => {
  it("continues a count-limited series with the remaining count", () => {
    const e = series({ repeatEndType: "count", repeatCount: 10 });
    const source = followingSource(e, "2026-11-02"); // 5th occurrence
    expect(source.repeatCount).toBe(6);
    const p = splitSeries(petWith(e), e, "2026-11-02", { ...source, time: "19:00" }, "22222222-2222-4222-8222-222222222222");
    expect(showDays(p.events, "2026-01-01", "2027-12-31")).toEqual(showDays([e], "2026-01-01", "2027-12-31"));
    expect(p.events.map((x) => [x.id, x.end, x.repeatEndType])).toEqual([
      [e.id, "2026-11-01", "date"],
      ["22222222-2222-4222-8222-222222222222", "", "count"],
    ]);
  });

  it("moves completion marks and per-day changes after the boundary to the new series", () => {
    const e = series({ exceptions: [{ on: "2026-10-12", cancelled: true }, { on: "2026-10-26", name: "Особый" }] });
    const done = { [`${e.id}:2026-10-05`]: true, [`${e.id}:2026-10-26`]: true };
    const newId = "33333333-3333-4333-8333-333333333333";
    const p = splitSeries(petWith(e, done), e, "2026-10-19", followingSource(e, "2026-10-19"), newId);
    expect(p.done).toEqual({ [`${e.id}:2026-10-05`]: true, [`${newId}:2026-10-26`]: true });
    expect(p.events[0].exceptions).toEqual([{ on: "2026-10-12", cancelled: true }]);
    expect(p.events[1].exceptions).toEqual([{ on: "2026-10-26", name: "Особый" }]);
    expect(eventsFor(p, "2026-10-26")[0]).toMatchObject({ id: newId, name: "Особый" });
  });

  it("drops per-day changes when the new part has a different schedule", () => {
    const e = series({ exceptions: [{ on: "2026-10-26", name: "Особый" }] });
    const p = splitSeries(petWith(e), e, "2026-10-19",
      { ...followingSource(e, "2026-10-19"), repeatWeekdays: [2] }, "44444444-4444-4444-8444-444444444444");
    expect(p.events[1].exceptions).toBeUndefined();
  });

  it("keeps «last day of the month» when a month-end series is split in February", () => {
    const e = series({ date: "2026-01-31", repeat: "monthly" });
    const source = followingSource(e, "2026-02-28");
    expect(source).toMatchObject({ date: "2026-02-28", repeatMonthday: 31 });
    const p = splitSeries(petWith(e), e, "2026-02-28", source, "55555555-5555-4555-8555-555555555555");
    expect(showDays(p.events, "2026-01-01", "2026-05-31")).toEqual(["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30", "2026-05-31"]);
  });

  it("edits in place when the boundary is the first occurrence", () => {
    const e = series();
    const p = splitSeries(petWith(e), e, "2026-10-05", { ...e, name: "Новое" }, "66666666-6666-4666-8666-666666666666");
    expect(p.events).toEqual([expect.objectContaining({ id: e.id, name: "Новое" })]);
  });
});

describe("deleting occurrences", () => {
  it("cancels a moved occurrence by its scheduled day", () => {
    const e = series({ exceptions: [{ on: "2026-10-12", newDate: "2026-10-14" }] });
    const p = deleteOccurrence(petWith(e, { [`${e.id}:2026-10-14`]: true }), e, "2026-10-14");
    expect(p.events[0].exceptions).toEqual([{ on: "2026-10-12", cancelled: true }]);
    expect(p.done).toEqual({});
  });

  it("this and following: ends the series and clears later completion marks", () => {
    const e = series();
    const p = deleteFollowing(petWith(e, { [`${e.id}:2026-10-05`]: true, [`${e.id}:2026-10-19`]: true }), e, "2026-10-19");
    expect(p.events[0]).toMatchObject({ end: "2026-10-18", repeatEndType: "date" });
    expect(p.done).toEqual({ [`${e.id}:2026-10-05`]: true });
  });

  it("editing the whole series keeps per-day changes only while the schedule is the same", () => {
    const e = series({ exceptions: [{ on: "2026-10-12", time: "10:00" }] });
    expect(editAll(petWith(e), e, { ...e, name: "Переименовано" }).events[0].exceptions).toEqual(e.exceptions);
    expect(editAll(petWith(e), e, { ...e, repeatInterval: 2 }).events[0].exceptions).toBeUndefined();
  });
});

describe("transport of the normalized calendar", () => {
  it("keeps overrides and the time zone when state is parsed", () => {
    const e = series({ timezone: "Asia/Yekaterinburg", exceptions: [{ on: "2026-10-12", newDate: "2026-10-13", name: "Иначе", time: "", note: "x", kind: "reminder", category: "health" }] });
    expect(eventSchema.parse(e)).toEqual(e);
    const p = petWith(e);
    const state = stateSchema.parse({ version: 1, selectedPet: p.id, pets: [p] });
    expect(state.pets[0].events[0]).toEqual(e);
  });

  it("tells the server whether the calendar changed", () => {
    const before = { version: 1 as const, selectedPet: "", pets: [petWith(series())] };
    const renamed = { ...before, pets: [{ ...before.pets[0], name: "Новое имя" }] };
    expect(sharedChanges(renamed, before).changes[0].updateCalendar).toBe(false);
    const ticked = { ...before, pets: [{ ...before.pets[0], done: { x: true } }] };
    expect(sharedChanges(ticked, before).changes[0].updateCalendar).toBe(true);
  });
});
