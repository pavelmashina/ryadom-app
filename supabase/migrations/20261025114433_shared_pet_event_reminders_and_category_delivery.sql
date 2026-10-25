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
   where cfg.enabled and (case when cfg.event_type='reminder'
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
end $function$;

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
$function$;

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
   on conflict(stock_item_id,user_id,level,cycle) do nothing;
  get diagnostics inserted_count=row_count;
  created_count:=created_count+inserted_count;
 end loop;
 return created_count;
end $function$;

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
 where coalesce(pref.reminders_enabled,true) and d.attempts<4 and
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
$function$;

-- Shared event reminder configuration; all active pet members may read and update it.
create or replace function public.get_shared_event_reminder(p_event uuid)
returns table(id uuid,event_id uuid,user_id uuid,offset_value integer,offset_unit text,enabled boolean)
language sql security definer set search_path = ''
as $$
  select rem.id,rem.event_id,rem.user_id,rem.offset_value,rem.offset_unit,rem.enabled
  from public.calendar_events e
  join public.pets pet on pet.id=e.pet_id and pet.deleted_at is null
  join public.pet_members member on member.pet_id=e.pet_id and member.user_id=auth.uid() and member.status='active'
  join public.event_reminders rem on rem.event_id=e.id and rem.pet_id=e.pet_id
  join public.pet_members author on author.pet_id=e.pet_id and author.user_id=rem.user_id and author.status='active'
  where e.id=p_event and auth.uid() is not null
  order by rem.updated_at desc,rem.id desc limit 1
$$;

create or replace function public.set_shared_event_reminder(p_event uuid,p_minutes integer,p_enabled boolean)
returns void language plpgsql security definer set search_path = ''
as $$
declare actual_pet uuid; existing_row uuid; actor uuid:=auth.uid();
begin
  if actor is null then raise exception 'Требуется авторизация'; end if;
  if p_minutes is null or p_minutes < 0 or p_minutes > 525600 or p_enabled is null then
    raise exception 'Некорректное время напоминания';
  end if;
  select evt.pet_id into actual_pet from public.calendar_events evt
    join public.pets pet on pet.id=evt.pet_id and pet.deleted_at is null
    join public.pet_members member on member.pet_id=evt.pet_id
      and member.user_id=actor and member.status='active'
    where evt.id=p_event;
  if actual_pet is null then raise exception 'Событие недоступно'; end if;
  select rem.id into existing_row from public.event_reminders rem
    where rem.event_id=p_event and rem.pet_id=actual_pet
      and rem.user_id=actor and rem.source='native'
    order by rem.updated_at desc,rem.id desc limit 1 for update;
  if existing_row is null then
    insert into public.event_reminders(event_id,pet_id,user_id,offset_value,offset_unit,enabled,source,updated_at)
    values(p_event,actual_pet,actor,p_minutes,'minutes',p_enabled,'native',now());
  else
    update public.event_reminders
    set offset_value=p_minutes,offset_unit='minutes',enabled=p_enabled,updated_at=now()
    where id=existing_row;
  end if;
end $$;

revoke all on function public.get_shared_event_reminder(uuid) from public,anon;
revoke all on function public.set_shared_event_reminder(uuid,integer,boolean) from public,anon;
grant execute on function public.get_shared_event_reminder(uuid) to authenticated;
grant execute on function public.set_shared_event_reminder(uuid,integer,boolean) to authenticated;
