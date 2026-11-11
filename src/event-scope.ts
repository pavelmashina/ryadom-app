// Editing / deleting one occurrence, this-and-following, or a whole series.
// `on` is always the day the occurrence is SHOWN on; moved occurrences are
// resolved to their scheduled day with originalOn().
import type { Pet, PetEvent } from "./domain";
import { eventInstance } from "./domain";
import {
  OVERRIDE_KEYS,
  occurrencesBefore,
  occursOn,
  originalOn,
  pinnedPattern,
  previousDay,
  type CalendarException,
} from "./recurrence";

export type EventScope = "single" | "future" | "all";

const doneKey = (id: string, day: string) => `${id}:${day}`;
const withoutDone = (done: Pet["done"], keep: (key: string) => boolean) =>
  Object.fromEntries(Object.entries(done).filter(([key]) => keep(key)));
// Same schedule ⇒ exceptions keyed by scheduled day keep their meaning.
const samePattern = (a: PetEvent, b: PetEvent) =>
  a.repeat === b.repeat &&
  (a.repeatInterval ?? 1) === (b.repeatInterval ?? 1) &&
  JSON.stringify(pinnedPattern(a)) === JSON.stringify(pinnedPattern(b));
const replaceEvent = (p: Pet, id: string, events: PetEvent[]) => {
  const at = p.events.findIndex((x) => x.id === id);
  if (at < 0) return [...p.events, ...events];
  return [...p.events.slice(0, at), ...events, ...p.events.slice(at + 1)];
};

/** Form values for editing only the occurrence shown on `on`. */
export function singleOccurrenceSource(e: PetEvent, on: string): PetEvent {
  return {
    ...eventInstance(e, on),
    date: on,
    repeat: "once",
    end: "",
    repeatEndType: undefined,
    repeatCount: undefined,
    exceptions: undefined,
  };
}

/** Form values for "this and following": the remaining part of the series. */
export function followingSource(e: PetEvent, on: string): PetEvent {
  const boundary = originalOn(e, on);
  return {
    ...e,
    ...pinnedPattern(e),
    date: boundary,
    ...(e.repeatEndType === "count"
      ? { repeatCount: Math.max(1, (e.repeatCount ?? 1) - occurrencesBefore(e, boundary)) }
      : {}),
    exceptions: undefined,
  };
}

/**
 * "All events of the series" (or a one-off event): replace in place. Per-day
 * changes survive only while the schedule they refer to is unchanged.
 */
export function editAll(p: Pet, e: PetEvent, next: PetEvent): Pet {
  const keep = e.repeat !== "once" && next.date === e.date && samePattern(e, next);
  const updated: PetEvent = { ...next, id: e.id, exceptions: keep ? e.exceptions : undefined };
  return { ...p, events: p.events.map((x) => (x.id === e.id ? updated : x)) };
}

/**
 * "Only this occurrence": stored as an override on the series' exception for
 * the scheduled day; the series itself and its ID stay unchanged.
 */
export function editOccurrence(p: Pet, e: PetEvent, on: string, next: PetEvent): Pet {
  const scheduled = originalOn(e, on);
  const exception: CalendarException = { on: scheduled };
  if (next.date !== scheduled) exception.newDate = next.date;
  for (const key of OVERRIDE_KEYS) {
    const value = next[key] ?? (key === "kind" ? "event" : undefined);
    const base = e[key] ?? (key === "kind" ? "event" : undefined);
    if (value !== base) (exception as Record<string, unknown>)[key] = value;
  }
  const others = (e.exceptions ?? []).filter((x) => x.on !== scheduled);
  const changed = Object.keys(exception).length > 1;
  const series = { ...e, exceptions: changed ? [...others, exception] : others.length ? others : undefined };
  let done = p.done;
  if (next.date !== on && p.done[doneKey(e.id, on)]) {
    done = withoutDone(p.done, (key) => key !== doneKey(e.id, on));
    done[doneKey(e.id, next.date)] = true;
  }
  return { ...p, done, events: p.events.map((x) => (x.id === e.id ? series : x)) };
}

/**
 * "This and following": the series ends the day before the occurrence and a
 * new series (newId) continues from it. Count limits continue with what is
 * left (followingSource shows that), completion marks and moved/overridden
 * occurrences after the boundary move to the new series.
 */
export function splitSeries(p: Pet, e: PetEvent, on: string, next: PetEvent, newId: string): Pet {
  const boundary = originalOn(e, on);
  if (boundary <= e.date) return editAll(p, e, next);
  const past: PetEvent = {
    ...e,
    end: previousDay(boundary),
    repeatEndType: "date",
    repeatCount: undefined,
    exceptions: (e.exceptions ?? []).filter((x) => x.on < boundary),
  };
  if (!past.exceptions?.length) past.exceptions = undefined;
  const carried = samePattern(e, next) && next.date === boundary
    ? (e.exceptions ?? []).filter((x) => x.on >= boundary)
    : [];
  const following: PetEvent = {
    ...next,
    id: newId,
    exceptions: carried.length ? carried : undefined,
  };
  const done = withoutDone(p.done, (key) => {
    const [id, day] = key.split(":");
    return id !== e.id || day < boundary;
  });
  for (const [key, value] of Object.entries(p.done)) {
    const [id, day] = key.split(":");
    if (id === e.id && day >= boundary && value && occursOn(following, day))
      done[doneKey(newId, day)] = true;
  }
  return { ...p, done, events: replaceEvent(p, e.id, [past, following]) };
}

/** Removes only the occurrence shown on `on`. */
export function deleteOccurrence(p: Pet, e: PetEvent, on: string): Pet {
  const scheduled = originalOn(e, on);
  const series = {
    ...e,
    exceptions: [...(e.exceptions ?? []).filter((x) => x.on !== scheduled), { on: scheduled, cancelled: true }],
  };
  return {
    ...p,
    done: withoutDone(p.done, (key) => key !== doneKey(e.id, on)),
    events: p.events.map((x) => (x.id === e.id ? series : x)),
  };
}

/** Removes the whole event/series and its completion marks. */
export function deleteAll(p: Pet, e: PetEvent): Pet {
  return {
    ...p,
    events: p.events.filter((x) => x.id !== e.id),
    done: withoutDone(p.done, (key) => !key.startsWith(e.id + ":")),
  };
}

/** Removes the occurrence shown on `on` and everything after it. */
export function deleteFollowing(p: Pet, e: PetEvent, on: string): Pet {
  const boundary = originalOn(e, on);
  if (boundary <= e.date) return deleteAll(p, e);
  const exceptions = (e.exceptions ?? []).filter((x) => x.on < boundary);
  const series: PetEvent = {
    ...e,
    end: previousDay(boundary),
    repeatEndType: "date",
    repeatCount: undefined,
    exceptions: exceptions.length ? exceptions : undefined,
  };
  return {
    ...p,
    done: withoutDone(p.done, (key) => {
      const [id, day] = key.split(":");
      return id !== e.id || occursOn(series, day);
    }),
    events: p.events.map((x) => (x.id === e.id ? series : x)),
  };
}
