-- Per-account notification preferences, shared events, global training offset.
create table public.notification_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  trainings_enabled boolean not null default false,
  events_enabled boolean not null default true,
  reminders_enabled boolean not null default true,
  training_offset_minutes integer not null default 60
    check (training_offset_minutes between 0 and 10080),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.notification_preferences enable row level security;
create policy notification_prefs_read on public.notification_preferences
  for select to authenticated using (user_id=(select auth.uid()));
create policy notification_prefs_insert on public.notification_preferences
  for insert to authenticated with check (user_id=(select auth.uid()));
create policy notification_prefs_update on public.notification_preferences
  for update to authenticated using (user_id=(select auth.uid()))
  with check (user_id=(select auth.uid()));
revoke all on public.notification_preferences from public,anon,authenticated;
grant select,insert,update on public.notification_preferences to authenticated;
grant select,insert,update,delete on public.notification_preferences to service_role;
alter table public.training_reminders add column source text not null default 'personal'
  check (source in ('personal','account'));

CREATE OR REPLACE FUNCTION public.enqueue_due_push()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare count_added integer; moment timestamptz:=now();
begin
 with configured as (
   select distinct on (rem.event_id) rem.id as reminder_id,rem.event_id,
     rem.offset_value,rem.offset_unit,e.pet_id,e.type as event_type,
     e.starts_on,e.time_of_day,e.timezone,e.recurrence_rule_id
   from public.event_reminders rem
   join public.calendar_events e on e.id=rem.event_id and e.pet_id=rem.pet_id
   join public.pet_members origin on origin.pet_id=rem.pet_id and origin.user_id=rem.user_id
     and origin.status='active'
   where rem.enabled
   order by rem.event_id,rem.updated_at desc,rem.id desc
 ),
 active_reminders as (
   select cfg.reminder_id,member.user_id,cfg.event_id,cfg.offset_value,
     cfg.offset_unit,cfg.pet_id,cfg.starts_on,cfg.time_of_day,cfg.timezone,
     cfg.recurrence_rule_id,
     cfg.offset_value * case cfg.offset_unit when 'weeks' then 10080
       when 'days' then 1440 when 'hours' then 60 else 1 end as offset_minutes
   from configured cfg
   join public.pets p on p.id=cfg.pet_id and p.deleted_at is null
   join public.pet_members member on member.pet_id=cfg.pet_id and member.status='active'
   left join public.notification_preferences pref on pref.user_id=member.user_id
   where (case when cfg.event_type='reminder'
     then coalesce(pref.reminders_enabled,true)
     else coalesce(pref.events_enabled,true) end)
     and cfg.offset_value * case cfg.offset_unit when 'weeks' then 10080
       when 'days' then 1440 when 'hours' then 60 else 1 end <= 525600
 ),
 occurrences as (
   select ar.*, d.on_day::date occurrence_day,
      ((d.on_day::date+coalesce(ar.time_of_day,time '09:00'))
        at time zone ar.timezone) as occurrence_at
   from active_reminders ar
   cross join lateral generate_series(
     ((moment+(ar.offset_minutes*interval '1 minute'))
        at time zone ar.timezone)::date-1,
     ((moment+(ar.offset_minutes*interval '1 minute'))
        at time zone ar.timezone)::date+1,
      interval '1 day') d(on_day)
 ),
 due as (
 select o.user_id,o.event_id,o.occurrence_at,o.reminder_id
 from occurrences o
 where o.occurrence_at-(o.offset_minutes*interval '1 minute')
         >= moment-interval '2 minutes'
   and o.occurrence_at-(o.offset_minutes*interval '1 minute')
         <= moment+interval '1 minute'
   and (
     (o.recurrence_rule_id is null and o.occurrence_day=o.starts_on)
     or (o.recurrence_rule_id is not null and
         pet_private.recurrence_occurs(o.recurrence_rule_id,o.occurrence_day))
   )
 )
 insert into public.notification_deliveries(user_id,event_id,occurrence_at,reminder_id)
 select user_id,event_id,occurrence_at,reminder_id from due
 on conflict(user_id,event_id,occurrence_at,reminder_id) do nothing;
 get diagnostics count_added=row_count;
 return count_added;
end $function$
;

CREATE OR REPLACE FUNCTION public.claim_due_push(max_jobs integer DEFAULT 30)
 RETURNS TABLE(id uuid, user_id uuid, event_id uuid, reminder_id uuid, occurrence_at timestamp with time zone, title text, comment text, timezone text)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
with picked as (
 select d.id from public.notification_deliveries d
 join public.event_reminders rem on rem.id=d.reminder_id and rem.enabled
 join public.calendar_events evt on evt.id=d.event_id and evt.id=rem.event_id and evt.pet_id=rem.pet_id
 join public.pets p on p.id=evt.pet_id and p.deleted_at is null
 join public.pet_members member on member.pet_id=evt.pet_id and member.user_id=d.user_id and member.status='active'
 join public.pet_members source_member on source_member.pet_id=evt.pet_id and source_member.user_id=rem.user_id and source_member.status='active'
 left join public.notification_preferences pref on pref.user_id=d.user_id
 where (case when evt.type='reminder' then coalesce(pref.reminders_enabled,true)
              else coalesce(pref.events_enabled,true) end)
   and d.attempts<4 and
  (
    (d.status in ('pending','failed') and d.next_attempt_at<=now())
    or (d.status='processing' and d.claimed_at<now()-interval '5 minutes')
  )
 order by d.created_at,d.id
 limit least(greatest(max_jobs,1),50)
 for update of d skip locked
),
claimed as (
 update public.notification_deliveries d
 set status='processing', attempts=d.attempts+1,
     claimed_at=now(),
     next_attempt_at=now()+make_interval(secs=>least(3600,60*power(2,d.attempts)::integer))
 from picked where d.id=picked.id
 returning d.id,d.user_id,d.event_id,d.reminder_id,d.occurrence_at
)
select c.id,c.user_id,c.event_id,c.reminder_id,c.occurrence_at,
       e.title,e.comment,e.timezone
from claimed c join public.calendar_events e on e.id=c.event_id
$function$
;

CREATE OR REPLACE FUNCTION public.enqueue_due_training_push()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare count_added integer; moment timestamptz:=now();
begin
  -- Backfill default account reminders only when globally enabled. A personal
  -- reminder for the same schedule/one-off takes precedence via unique indexes.
  insert into public.training_reminders
    (user_id,pet_id,schedule_id,offset_value,offset_unit,enabled,source)
  select member.user_id,sc.pet_id,sc.id,pref.training_offset_minutes,'minutes',true,'account'
  from public.training_schedules sc
  join public.pets p on p.id=sc.pet_id and p.deleted_at is null
  join public.pet_members member on member.pet_id=sc.pet_id and member.status='active'
  join public.notification_preferences pref on pref.user_id=member.user_id and pref.trainings_enabled
  where sc.is_active
  on conflict do nothing;
  insert into public.training_reminders
    (user_id,pet_id,session_id,offset_value,offset_unit,enabled,source)
  select member.user_id,s.pet_id,s.id,pref.training_offset_minutes,'minutes',true,'account'
  from public.training_sessions s
  join public.pets p on p.id=s.pet_id and p.deleted_at is null
  join public.pet_members member on member.pet_id=s.pet_id and member.status='active'
  join public.notification_preferences pref on pref.user_id=member.user_id and pref.trainings_enabled
  where s.schedule_id is null and s.status='planned'
    and s.scheduled_at between moment-interval '1 day' and moment+interval '8 days'
  on conflict do nothing;
  -- A user's account-wide offset applies to auto-created reminders; explicit
  -- per-workout preferences are not overwritten.
  update public.training_reminders r set
    offset_value=pref.training_offset_minutes,offset_unit='minutes',enabled=true,updated_at=now()
  from public.notification_preferences pref
  where pref.user_id=r.user_id and pref.trainings_enabled and r.source='account'
    and (r.offset_value is distinct from pref.training_offset_minutes
      or r.offset_unit<>'minutes' or not r.enabled);
  with eligible as (
    select s.id as session_id,s.scheduled_at,r.id as reminder_id,r.user_id,
      r.offset_value * case r.offset_unit
        when 'weeks' then 10080 when 'days' then 1440
        when 'hours' then 60 else 1 end as offset_minutes
    from public.training_reminders r
    join public.training_sessions s
      on s.pet_id=r.pet_id
      and (r.session_id=s.id or (r.schedule_id is not null and r.schedule_id=s.schedule_id))
    left join public.training_schedules sc on sc.id=s.schedule_id
    join public.pets p on p.id=r.pet_id and p.deleted_at is null
    join public.pet_members m on m.pet_id=r.pet_id and m.user_id=r.user_id
      and m.status='active'
    left join public.notification_preferences pref on pref.user_id=r.user_id
    where (coalesce(pref.trainings_enabled,false) or
      (pref.user_id is null and r.source='personal'))
      and r.enabled and s.status='planned' and s.scheduled_at is not null
      and (s.schedule_id is null or sc.is_active)
  )
  insert into public.training_notification_deliveries
    (user_id,reminder_id,session_id,occurrence_at,offset_minutes)
  select user_id,reminder_id,session_id,scheduled_at,offset_minutes
  from eligible
  where scheduled_at-(offset_minutes*interval '1 minute')
    between moment-interval '2 minutes' and moment+interval '1 minute'
  on conflict(user_id,reminder_id,session_id,occurrence_at) do nothing;
  get diagnostics count_added=row_count;
  return count_added;
end $function$
;

CREATE OR REPLACE FUNCTION public.claim_due_training_push(max_jobs integer DEFAULT 25)
 RETURNS TABLE(id uuid, user_id uuid, session_id uuid, reminder_id uuid, occurrence_at timestamp with time zone, title text, comment text, timezone text)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
with picked as (
  select d.id
  from public.training_notification_deliveries d
  join public.training_reminders r on r.id=d.reminder_id and r.user_id=d.user_id
  join public.training_sessions s on s.id=d.session_id and s.pet_id=r.pet_id
  left join public.training_schedules sc on sc.id=s.schedule_id
  join public.pets p on p.id=r.pet_id and p.deleted_at is null
  join public.pet_members m on m.pet_id=r.pet_id and m.user_id=d.user_id
    and m.status='active'
  left join public.notification_preferences pref on pref.user_id=d.user_id
  where (coalesce(pref.trainings_enabled,false) or
    (pref.user_id is null and r.source='personal'))
    and d.attempts<4 and
    ((d.status in ('pending','failed') and d.next_attempt_at<=now())
     or (d.status='processing' and d.claimed_at<now()-interval '5 minutes'))
    and r.enabled and s.status='planned'
    and s.scheduled_at=d.occurrence_at
    and (s.schedule_id is null or sc.is_active)
    and (r.session_id=s.id or (r.schedule_id is not null and r.schedule_id=s.schedule_id))
    and d.offset_minutes=r.offset_value *
      case r.offset_unit when 'weeks' then 10080 when 'days' then 1440
        when 'hours' then 60 else 1 end
  order by d.created_at,d.id
  limit least(greatest(max_jobs,1),50)
  for update of d skip locked
),
claimed as (
  update public.training_notification_deliveries d
  set status='processing', attempts=d.attempts+1, claimed_at=now(),
    next_attempt_at=now()+make_interval(secs=>least(3600,60*power(2,d.attempts)::integer))
  from picked where d.id=picked.id
  returning d.id,d.user_id,d.session_id,d.reminder_id,d.occurrence_at
)
select c.id,c.user_id,c.session_id,c.reminder_id,c.occurrence_at,
  coalesce(nullif(s.name,''),nullif(sc.name,''),'Тренировка') as title,
  s.comment,coalesce(sc.timezone,'Europe/Moscow') as timezone
from claimed c
join public.training_sessions s on s.id=c.session_id
left join public.training_schedules sc on sc.id=s.schedule_id
$function$
;
