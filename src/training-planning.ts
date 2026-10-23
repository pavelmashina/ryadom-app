import { z } from "zod";
export const scheduleSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().max(120),
  time_of_day: z.string().nullable(),
  repeat_type: z.enum(["daily", "weekly", "weekdays"]),
  recurrence_frequency: z.enum(["daily","weekly","monthly","yearly"]).nullable().optional(),
  recurrence_interval: z.number().int().min(1).max(366).optional(),
  recurrence_end_type: z.enum(["never","date","count"]).nullable().optional(),
  recurrence_count: z.number().int().min(1).max(10000).nullable().optional(),
  recurrence_monthday: z.number().int().min(1).max(32).nullable().optional(),
  weekdays: z.array(z.number().int().min(1).max(7)),
  starts_on: z.string(),
  ends_on: z.string().nullable(),
  is_active: z.boolean(),
  comment: z.string().max(5000),
  command_ids: z.array(z.string()),
});
export type TrainingSchedule = z.infer<typeof scheduleSchema>;
export function trainingTimestamp(day: string, time: string) {
  // The database stores recurring workout times in Europe/Moscow.
  // Moscow observes UTC+03 throughout the year; parse a fixed offset rather
  // than using the device timezone (which shifts planned reminders).
  return new Date(day + "T" + (time || "12:00") + ":00+03:00").toISOString();
}
