import type { TrainingSession } from "./training-domain";

/**
 * Display status for a workout. A planned workout becomes missed after its
 * scheduled calendar day has passed without completion. We deliberately keep
 * the persisted "planned" status unchanged so the existing edit, move, and
 * cancellation flows remain available for an overdue workout.
 */
export function trainingStatusLabel(
  workout: Pick<TrainingSession, "status" | "date">,
  currentDay: string,
): "Запланирована" | "Пропущена" | "Проведена" | "Отменена" {
  if (workout.status === "cancelled") return "Отменена";
  if (workout.status === "planned") {
    return workout.date < currentDay ? "Пропущена" : "Запланирована";
  }
  return "Проведена";
}
