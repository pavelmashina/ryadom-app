import { recurrenceText } from "./recurrence";
import type { TrainingSchedule } from "./training-planning";

/** Same recurrence metadata as a regular event, including the end condition. */
export function trainingScheduleText(schedule?: TrainingSchedule): string {
  if (!schedule) return "Однократно";
  return recurrenceText({
    date: schedule.starts_on,
    repeat: schedule.recurrence_frequency ??
      (schedule.repeat_type === "weekdays" ? "weekly" : "daily"),
    repeatInterval: schedule.recurrence_interval ?? 1,
    repeatWeekdays: schedule.weekdays,
    repeatMonthday: schedule.recurrence_monthday ?? undefined,
    repeatEndType: schedule.recurrence_end_type ??
      (schedule.ends_on ? "date" : "never"),
    repeatCount: schedule.recurrence_count ?? undefined,
    end: schedule.ends_on ?? "",
  });
}
