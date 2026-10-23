import type { Pet } from "./domain";
import { trainingTimestamp } from "./training-planning";
import { trainingSchema } from "./training-domain";

export type CancellationScope = "one" | "following";

/** Cancel just this occurrence or stop its recurring schedule before this day.
 * Completed sessions are never modified. A cancelled occurrence retains its
 * original identity, so the recurrence expander cannot recreate it unchanged.
 */
export function cancelPlannedTraining(pet: Pet, sessionId: string, scope: CancellationScope): Pet {
  const target = pet.workouts.find(item => item.id === sessionId);
  if (!target || target.status !== "planned")
    throw new Error("Отменить можно только запланированную тренировку.");
  const schedule = target.schedule_id
    ? pet.trainingSchedules?.find(x => x.id === target.schedule_id)
    : undefined;
  if (scope === "following" && !schedule)
    throw new Error("У этой тренировки нет регулярного графика.");
  const cancelledAt = new Date().toISOString();
  const workouts = pet.workouts.map(item =>
    item.status === "planned" &&
    (item.id === target.id || (scope === "following" && schedule &&
      item.schedule_id === schedule.id && item.date >= target.date))
      ? { ...item, status: "cancelled" as const, updated_at: cancelledAt }
      : item,
  );
  if (scope !== "following" || !schedule) return { ...pet, workouts };
  const priorDay = new Date(target.date + "T12:00:00Z");
  priorDay.setUTCDate(priorDay.getUTCDate() - 1);
  const cutoff = priorDay.toISOString().slice(0, 10);
  const disable = cutoff < schedule.starts_on;
  return {
    ...pet,
    workouts,
    trainingSchedules: (pet.trainingSchedules ?? []).map(x => x.id === schedule.id
      ? disable ? { ...x, is_active: false } : {
          ...x,
          ends_on: cutoff,
          recurrence_end_type: "date" as const,
          recurrence_count: null,
        }
      : x),
  };
}


/** Move a one-off planned session without creating a second session ID. */
export function reschedulePlannedTraining(
  pet: Pet, sessionId: string, day: string, time: string,
): Pet {
  const previous = pet.workouts.find((item) => item.id === sessionId);
  if (!previous || previous.status !== "planned")
    throw new Error("Перенести можно только запланированную тренировку.");
  if (previous.schedule_id)
    throw new Error("Эта тренировка создана регулярным графиком. Измените график занятий.");
  const next = trainingSchema.parse({
    ...previous,
    date: day,
    time,
    scheduled_at: trainingTimestamp(day, time),
    updated_at: new Date().toISOString(),
  });
  return {
    ...pet,
    workouts: pet.workouts.map((item) => item.id === sessionId ? next : item),
  };
}
