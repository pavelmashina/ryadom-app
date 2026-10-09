import { z } from "zod";
export const scheduleSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().max(120),
  time_of_day: z.string().nullable(),
  repeat_type: z.enum(["daily", "weekly", "weekdays"]),
  weekdays: z.array(z.number().int().min(1).max(7)),
  starts_on: z.string(),
  ends_on: z.string().nullable(),
  is_active: z.boolean(),
  comment: z.string().max(5000),
  command_ids: z.array(z.string()),
});
export type TrainingSchedule = z.infer<typeof scheduleSchema>;
export function trainingTimestamp(day: string, time: string) {
  return new Date(day + "T" + (time || "12:00") + ":00").toISOString();
}
