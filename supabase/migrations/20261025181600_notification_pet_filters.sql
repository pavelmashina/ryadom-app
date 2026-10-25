-- NULL category selection means all current and future authorized pets.
alter table public.notification_preferences
  add column if not exists trainings_pet_ids uuid[] default null,
  add column if not exists events_pet_ids uuid[] default null,
  add column if not exists reminders_pet_ids uuid[] default null;

create or replace function pet_private.notification_pet_allowed(p_user uuid,p_pet uuid,p_kind text)
returns boolean language sql stable set search_path to '' as $filter$
  select coalesce((
    select case p_kind
      when 'training' then (pref.trainings_pet_ids is null or p_pet=any(pref.trainings_pet_ids))
      when 'event' then (pref.events_pet_ids is null or p_pet=any(pref.events_pet_ids))
      when 'reminder' then (pref.reminders_pet_ids is null or p_pet=any(pref.reminders_pet_ids))
      else false
    end
    from public.notification_preferences pref where pref.user_id=p_user
  ),true)
$filter$;
revoke all on function pet_private.notification_pet_allowed(uuid,uuid,text) from public,anon,authenticated;

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
   and pet_private.notification_pet_allowed(d.user_id,evt.pet_id,evt.type)
   and rem.id = (select newest.id from public.event_reminders newest
     join public.pet_members author on author.pet_id=newest.pet_id
       and author.user_id=newest.user_id and author.status='active'
     where newest.event_id=evt.id and newest.pet_id=evt.pet_id
     order by newest.updated_at desc,newest.id desc limit 1)
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

CREATE OR REPLACE FUNCTION public.claim_due_stock_push(max_jobs integer DEFAULT 25)
 RETURNS TABLE(id uuid, user_id uuid, stock_item_id uuid, pet_id uuid, occurrence_at timestamp with time zone, title text, comment text, timezone text)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
with picked as (
 select d.id from public.stock_notification_deliveries d
 join public.stock_items item on item.id=d.stock_item_id and item.archived_at is null
 join public.pets p on p.id=item.pet_id and p.deleted_at is null
 join public.pet_members member on member.pet_id=item.pet_id and member.user_id=d.user_id and member.status='active'
 left join public.notification_preferences pref on pref.user_id=d.user_id
 where coalesce(pref.reminders_enabled,true) and pet_private.notification_pet_allowed(d.user_id,item.pet_id,'reminder') and d.attempts<4 and
  ((d.status in ('pending','failed') and d.next_attempt_at<=now())
   or(d.status='processing' and d.claimed_at<now()-interval '5 minutes'))
 order by d.created_at,d.id
 limit least(greatest(max_jobs,1),50) for update skip locked
),
claimed as (
 update public.stock_notification_deliveries d
 set status='processing', attempts=d.attempts+1,claimed_at=now(),
  next_attempt_at=now()+make_interval(secs=>least(3600,60*power(2,d.attempts)::integer))
 from picked where d.id=picked.id
 returning d.*
)
select c.id,c.user_id,c.stock_item_id,i.pet_id,c.created_at,
 case when c.level='empty' then 'Запас закончился · '||i.name else 'Запас заканчивается · '||i.name end,
 case when c.level='empty' then 'Пополните запас.'
 else 'Осталось '||round(i.current_quantity/(case when i.display_unit in ('кг','л') then 1000 else 1 end),3) ||' '||i.display_unit end,
 'Europe/Moscow'::text
from claimed c join public.stock_items i on i.id=c.stock_item_id
$function$
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
    and pet_private.notification_pet_allowed(d.user_id,r.pet_id,'training')
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
     rem.offset_value,rem.offset_unit,rem.enabled,e.pet_id,e.type as event_type,
     e.starts_on,e.time_of_day,e.timezone,e.recurrence_rule_id
   from public.event_reminders rem
   join public.calendar_events e on e.id=rem.event_id and e.pet_id=rem.pet_id
   join public.pet_members origin on origin.pet_id=rem.pet_id and origin.user_id=rem.user_id
     and origin.status='active'
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
   where cfg.enabled and pet_private.notification_pet_allowed(member.user_id,cfg.pet_id,cfg.event_type) and (case when cfg.event_type='reminder'
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

CREATE OR REPLACE FUNCTION public.enqueue_due_stock_push()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare i public.stock_items; old_level text; next_level text; next_cycle integer;
 forecast_use numeric; first_day date:=(now() at time zone 'Europe/Moscow')::date;
 created_count integer:=0; inserted_count integer;
begin
 for i in select * from public.stock_items where archived_at is null order by id loop
  -- Future depletion within 3 actual dates, using the server recurrence matcher.
  select coalesce(sum(case when pet_private.stock_occurs(r,dd.d) then r.amount else 0 end),0)
    into forecast_use from public.stock_consumption_rules r
    cross join lateral generate_series(first_day+1,first_day+3,interval '1 day') dd(d)
    where r.stock_item_id=i.id and r.enabled;
  next_level:=case when not i.notifications_enabled then 'normal'
    when i.current_quantity=0 then 'empty'
    when (i.low_stock_threshold>0 and i.current_quantity<=i.low_stock_threshold)
      or (forecast_use>0 and forecast_use>=i.current_quantity) then 'low'
    else 'normal' end;
  insert into public.stock_alert_states(stock_item_id,level,cycle)
   values(i.id,'normal',0) on conflict(stock_item_id) do nothing;
  select level,cycle into old_level,next_cycle from public.stock_alert_states
   where stock_item_id=i.id for update;
  if next_level=old_level then continue; end if;
  if next_level<>'normal' then next_cycle:=next_cycle+1;end if;
  update public.stock_alert_states set level=next_level,cycle=next_cycle,updated_at=now()
   where stock_item_id=i.id;
  if next_level='normal' then continue; end if;
  insert into public.stock_notification_deliveries(stock_item_id,user_id,level,cycle)
   select i.id,m.user_id,next_level,next_cycle from public.pet_members m
   join public.pets p on p.id=m.pet_id
   left join public.notification_preferences pref on pref.user_id=m.user_id
   where m.pet_id=i.pet_id and m.status='active' and p.deleted_at is null
     and coalesce(pref.reminders_enabled,true)
     and pet_private.notification_pet_allowed(m.user_id,i.pet_id,'reminder')
   on conflict(stock_item_id,user_id,level,cycle) do nothing;
  get diagnostics inserted_count=row_count;
  created_count:=created_count+inserted_count;
 end loop;
 return created_count;
end $function$
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
  where sc.is_active and pet_private.notification_pet_allowed(member.user_id,sc.pet_id,'training')
  on conflict do nothing;
  insert into public.training_reminders
    (user_id,pet_id,session_id,offset_value,offset_unit,enabled,source)
  select member.user_id,s.pet_id,s.id,pref.training_offset_minutes,'minutes',true,'account'
  from public.training_sessions s
  join public.pets p on p.id=s.pet_id and p.deleted_at is null
  join public.pet_members member on member.pet_id=s.pet_id and member.status='active'
  join public.notification_preferences pref on pref.user_id=member.user_id and pref.trainings_enabled
  where s.schedule_id is null and s.status='planned' and pet_private.notification_pet_allowed(member.user_id,s.pet_id,'training')
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
      and pet_private.notification_pet_allowed(r.user_id,r.pet_id,'training')
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

