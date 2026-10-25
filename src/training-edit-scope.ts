import type { Pet } from "./domain";
import type { TrainingSession } from "./training-domain";
import type { TrainingSchedule } from "./training-planning";
import { occurrenceIndex, previousDay } from "./recurrence";
import { today } from "./domain";

export type TrainingEditScope = "single" | "future" | "all";

/** Build a new continuation while retaining the previous schedule's history. */
export function continuationSchedule(
  original: TrainingSchedule, occurrence: TrainingSession, nextId: string,
): TrainingSchedule {
  let remaining = original.recurrence_count ?? null;
  if (original.recurrence_end_type === "count" && remaining !== null) {
    const index = occurrenceIndex({
      date: original.starts_on,
      repeat: original.recurrence_frequency ??
        (original.repeat_type === "weekdays" ? "weekly" : "daily"),
      repeatInterval: original.recurrence_interval,
      repeatWeekdays: original.weekdays,
      repeatMonthday: original.recurrence_monthday ?? undefined,
      repeatEndType: original.recurrence_end_type,
      repeatCount: original.recurrence_count ?? undefined,
      end: original.ends_on ?? "",
    }, occurrence.date);
    if (index !== null) remaining = Math.max(1, remaining - index + 1);
  }
  return {
    ...original,
    id: nextId,
    starts_on: occurrence.date,
    recurrence_count: remaining,
  };
}

/** The form emits a full Pet draft. Apply edits without erasing completed
 * trainings, or accidentally changing earlier instances of a recurring plan.
 */
export function applyTrainingEditScope(
  draft: Pet,
  occurrence: TrainingSession,
  original: TrainingSchedule,
  scope: TrainingEditScope,
): Pet {
  if (scope === "single") return draft;

  if (scope === "all") {
    const edited = draft.trainingSchedules?.find(s => s.id === original.id);
    if (!edited || JSON.stringify(edited) === JSON.stringify(original)) return draft;
    return {
      ...draft,
      workouts: draft.workouts.filter(w =>
        !(w.schedule_id === original.id && w.status === "planned" && w.date >= today())),
    };
  }

  const cutoff = previousDay(occurrence.date);
  const stopped: TrainingSchedule = cutoff < original.starts_on
    ? { ...original, is_active: false }
    : {
        ...original, ends_on: cutoff,
        recurrence_end_type: "date", recurrence_count: null,
      };
  const schedules = (draft.trainingSchedules ?? []).map(s =>
    s.id === original.id ? stopped : s);
  if (!schedules.some(s => s.id === original.id)) throw new Error("Исходный график не найден");
  if (!schedules.some(s => s.id !== original.id && s.starts_on === occurrence.date))
    throw new Error("Новый график не сохранён");
  return {
    ...draft,
    trainingSchedules: schedules,
    workouts: draft.workouts.filter(w =>
      !(w.schedule_id === original.id && w.status === "planned" && w.date >= occurrence.date)),
  };
}
