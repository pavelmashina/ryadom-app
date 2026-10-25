import type { SharedEventReminder } from "./push-api";

export const REMINDER_MULTIPLIER = {
  minutes: 1,
  hours: 60,
  days: 1440,
  weeks: 10080,
} as const;
export type ReminderUnit = keyof typeof REMINDER_MULTIPLIER;
export type ReminderChoice = {
  mode: string;
  amount: number;
  unit: ReminderUnit;
};

/** One conversion path for event forms and personal reminder details. */
export function reminderChoice(minutes: number, enabled: boolean): ReminderChoice {
  if (!enabled) return { mode: "none", amount: 1, unit: "minutes" };
  if ([0, 10, 30, 60, 1440].includes(minutes)) {
    return { mode: String(minutes), amount: 1, unit: "minutes" };
  }
  const unit: ReminderUnit = minutes >= 10080 && minutes % 10080 === 0 ? "weeks"
    : minutes >= 1440 && minutes % 1440 === 0 ? "days"
    : minutes >= 60 && minutes % 60 === 0 ? "hours" : "minutes";
  return { mode: "custom", amount: minutes / REMINDER_MULTIPLIER[unit], unit };
}
export function savedReminderChoice(rows: SharedEventReminder[]): ReminderChoice {
  // Native per-user subscription overrides the shared/legacy event fields.
  const reminder = rows.find((row) => row.enabled);
  if (!reminder) return reminderChoice(0, false);
  return reminderChoice(
    reminder.offset_value * REMINDER_MULTIPLIER[reminder.offset_unit],
    true,
  );
}
export function reminderOffsetMinutes(
  mode: string, amount: number, unit: ReminderUnit,
): number {
  if (mode === "none") return 0;
  const minutes = mode === "custom"
    ? amount * REMINDER_MULTIPLIER[unit] : Number(mode);
  if (!Number.isSafeInteger(minutes) || minutes < 0 || minutes > 525600)
    throw new Error("Укажите корректный интервал напоминания (не более года)");
  return minutes;
}
