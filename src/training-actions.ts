import type { Pet } from "./domain";
import { trainingTimestamp } from "./training-planning";
import { trainingSchema } from "./training-domain";

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
