-- Support explicit last calendar day (32) for monthly training recurrences.
alter table public.training_schedules
  drop constraint training_schedules_recurrence_monthday_check;
alter table public.training_schedules
  add constraint training_schedules_recurrence_monthday_check
  check (recurrence_monthday between 1 and 32);
alter table public.recurrence_rules
  drop constraint recurrence_rules_day_of_month_check;
alter table public.recurrence_rules
  add constraint recurrence_rules_day_of_month_check
  check (day_of_month between 1 and 32);
-- Sentinel 32 represents the final calendar day (via LEAST(desired,last_day)).
