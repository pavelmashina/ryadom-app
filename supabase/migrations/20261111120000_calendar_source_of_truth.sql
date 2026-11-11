-- Issue #2, phase 2: the normalized calendar becomes the source of truth.
--
-- Before: events/done lived in pets.data and a trigger mirrored them into
-- calendar_events/recurrence_rules/... After: save_state writes the tables
-- directly, load_state builds the same JSON shape from them (transitional
-- compatibility for the client), and pets.data no longer holds the calendar.
--
-- Safety:
--  * the functions replaced below are checked against the exact definitions
--    this migration was written for; any drift aborts the migration;
--  * every pet's original events/done are copied to
--    pet_private.calendar_legacy_backup before anything changes;
--  * after the transfer each pet's calendar is compared field by field with
--    the original JSON; any difference aborts (and rolls back) the migration;
--  * training_sessions / training history are not touched.

-- 0. Refuse to run on top of unexpected function versions.
do $guard$
declare
  expected constant jsonb := jsonb_build_object(
    'pet_private.save_state(jsonb,jsonb,text)','881615479263779214bb1ee311bf7093',
    'pet_private.load_state()','2920b561dccf8c45c029f46983cb5236',
    'enqueue_due_push()','ab28275e13fca9482891814fa248f646',
    'claim_due_push(integer)','4ee1d4f10160d7a19041ef343bd89c6a');
  fn text; actual text;
begin
  for fn in select jsonb_object_keys(expected) loop
    select md5(pg_get_functiondef(fn::regprocedure)) into actual;
    if actual is distinct from expected->>fn then
      raise exception 'Calendar migration: % differs from the reviewed version (%). Review the migration before applying.', fn, actual;
    end if;
  end loop;
end $guard$;

-- 1. Backup of the legacy JSON calendar (kept; never read by the app).
create table if not exists pet_private.calendar_legacy_backup(
  pet_id uuid primary key,
  events jsonb not null,
  done jsonb not null,
  backed_up_at timestamptz not null default now()
);
alter table pet_private.calendar_legacy_backup enable row level security;
revoke all on pet_private.calendar_legacy_backup from public, anon, authenticated;
insert into pet_private.calendar_legacy_backup(pet_id, events, done)
select id, coalesce(data->'events','[]'::jsonb), coalesce(data->'done','{}'::jsonb)
from public.pets
on conflict (pet_id) do nothing;

-- 2. The mirror trigger is replaced by direct writes from save_state.
drop trigger if exists pet_calendar_mirror on public.pets;
drop function if exists pet_private.sync_pet_calendar_trigger();
drop function if exists pet_private.sync_calendar(uuid, jsonb);

-- 3. Schema additions.
alter table public.calendar_events
  add column if not exists reminder_minutes integer not null default 0
    check (reminder_minutes between 0 and 525600),
  add column if not exists reminder_enabled boolean,
  add column if not exists sort_order integer not null default 0,
  drop column if exists legacy_payload;

-- Deleting an account must not be blocked by events it once created.
alter table public.calendar_events drop constraint if exists calendar_events_created_by_fkey;
alter table public.calendar_events add constraint calendar_events_created_by_fkey
  foreign key (created_by) references auth.users(id) on delete set null;

-- "Only this occurrence" edits are stored as an override on the exception:
-- keys present in override_payload replace the series value for that day.
alter table public.calendar_event_exceptions
  drop constraint if exists calendar_event_exceptions_override_keys;
alter table public.calendar_event_exceptions
  add constraint calendar_event_exceptions_override_keys check (
    jsonb_typeof(override_payload) = 'object'
    and override_payload - array['name','time','note','kind','category'] = '{}'::jsonb
  );

-- Remember which scheduled occurrence a delivery belongs to (for overrides).
alter table public.notification_deliveries
  add column if not exists occurrence_on date;

create index if not exists calendar_events_rule_idx on public.calendar_events(recurrence_rule_id);
create index if not exists calendar_events_created_by_idx on public.calendar_events(created_by);
create index if not exists calendar_completions_pet_idx on public.calendar_event_completions(pet_id, occurrence_on);
create index if not exists calendar_exceptions_moved_idx on public.calendar_event_exceptions(event_id, moved_on)
  where moved_on is not null;

-- 4. Writes go through the versioned RPCs only.
drop policy if exists "events_member_insert" on public.calendar_events;
drop policy if exists "events_member_update" on public.calendar_events;
drop policy if exists "events_member_delete" on public.calendar_events;
revoke insert, update, delete on public.calendar_events from authenticated;

-- 5. Helpers.
create or replace function pet_private.valid_timezone(tz text)
returns text language sql stable security invoker set search_path = '' as $$
  select case
    when tz is not null and exists(select 1 from pg_catalog.pg_timezone_names n where n.name = tz) then tz
    else 'Europe/Moscow' end
$$;

-- Event JSON exactly as the client expects it (domain.ts eventSchema).
create or replace function pet_private.calendar_json(pid uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(
    jsonb_strip_nulls(jsonb_build_object(
      'id', e.id,
      'name', e.title,
      'category', e.category,
      'kind', e.type,
      'date', e.starts_on,
      'time', coalesce(to_char(e.time_of_day, 'HH24:MI'), ''),
      'note', e.comment,
      'reminder', e.reminder_minutes::text,
      'reminderEnabled', e.reminder_enabled,
      'linkedRecord', e.linked_record,
      'timezone', e.timezone,
      'repeat', coalesce(r.frequency, 'once'),
      'repeatInterval', r.interval,
      'repeatWeekdays', case when r.frequency = 'weekly' then to_jsonb(r.days_of_week) end,
      'repeatMonthday', case when r.frequency = 'monthly' then r.day_of_month end,
      'repeatEndType', r.end_type,
      'repeatCount', case when r.end_type = 'count' then r.occurrence_count end,
      'exceptions', (
        select jsonb_agg(
          jsonb_strip_nulls(jsonb_build_object(
            'on', x.original_on,
            'newDate', x.moved_on,
            'cancelled', case when x.cancelled then true end
          )) || x.override_payload
          order by x.original_on)
        from public.calendar_event_exceptions x
        where x.event_id = e.id and x.pet_id = e.pet_id)
    )) || jsonb_build_object('end', coalesce(case when r.end_type = 'date' then r.ends_on::text end, ''))
    order by e.sort_order, e.id), '[]'::jsonb)
  from public.calendar_events e
  left join public.recurrence_rules r on r.id = e.recurrence_rule_id and r.pet_id = e.pet_id
  where e.pet_id = pid
$$;

create or replace function pet_private.done_json(pid uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_object_agg(c.event_id::text || ':' || c.occurrence_on::text, true), '{}'::jsonb)
  from public.calendar_event_completions c
  where c.pet_id = pid and c.done
$$;

-- Validates and stores a pet's calendar. Callers must have checked access.
-- A null argument leaves that part unchanged (older clients may omit it).
create or replace function pet_private.store_calendar(pid uuid, p_events jsonb, p_done jsonb, actor uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  uuid_re constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  e jsonb; x jsonb; pos bigint; eid uuid; freq text; every_n integer; weekdays smallint[];
  monthday smallint; ending text; until date; repeat_count integer; starts date;
  tz text; override jsonb;
begin
  if p_events is not null then
    if jsonb_typeof(p_events) <> 'array' or jsonb_array_length(p_events) > 5000 then
      raise exception 'Некорректный календарь' using errcode = '23514';
    end if;
    if exists(select 1 from jsonb_array_elements(p_events) v
              where jsonb_typeof(v) <> 'object' or coalesce(v->>'id', '') !~* uuid_re) then
      raise exception 'Некорректный идентификатор события' using errcode = '23514';
    end if;
    if (select count(*) <> count(distinct lower(v->>'id')) from jsonb_array_elements(p_events) v) then
      raise exception 'Повторяющиеся события' using errcode = '23514';
    end if;
    if exists(select 1 from public.calendar_events c
              join jsonb_array_elements(p_events) v on c.id = (v->>'id')::uuid
              where c.pet_id <> pid) then
      raise exception 'Событие принадлежит другому питомцу' using errcode = '42501';
    end if;

    -- Removed events (cascades to exceptions, completions, reminders, deliveries).
    delete from public.calendar_events c where c.pet_id = pid
      and not exists(select 1 from jsonb_array_elements(p_events) v where (v->>'id')::uuid = c.id);
    delete from public.recurrence_rules r where r.pet_id = pid and r.source_type = 'event'
      and not exists(select 1 from public.calendar_events c where c.id = r.source_id and c.pet_id = pid);

    for e, pos in select v, o from jsonb_array_elements(p_events) with ordinality as t(v, o) loop
      eid := (e->>'id')::uuid;
      if length(btrim(coalesce(e->>'name', ''))) not between 1 and 120 then
        raise exception 'Введите название события' using errcode = '23514';
      end if;
      if coalesce(e->>'category', 'care') not in ('care', 'training', 'health')
        or coalesce(e->>'kind', 'event') not in ('event', 'reminder')
        or coalesce(e->>'repeat', 'once') not in ('once', 'daily', 'weekly', 'monthly', 'yearly')
        or coalesce(e->>'date', '') !~ '^\d{4}-\d{2}-\d{2}$'
        or coalesce(e->>'time', '') !~ '^$|^([01]\d|2[0-3]):[0-5]\d$'
        or length(coalesce(e->>'note', '')) > 5000
        or coalesce(e->>'reminder', '0') !~ '^\d{1,6}$' or coalesce(e->>'reminder', '0')::integer > 525600
      then
        raise exception 'Некорректное событие «%»', e->>'name' using errcode = '23514';
      end if;
      starts := (e->>'date')::date;
      -- IANA zone; validated only when it differs from the stored one.
      tz := case when e ? 'timezone' then e->>'timezone' end;
      if tz is not null and not exists(select 1 from public.calendar_events ce where ce.id = eid and ce.timezone = tz) then
        tz := pet_private.valid_timezone(tz);
      end if;
      freq := coalesce(e->>'repeat', 'once');

      -- One rule per series; occurrences are computed, never stored.
      if freq <> 'once' then
        every_n := greatest(1, least(366, coalesce(nullif(e->>'repeatInterval', '')::integer, 1)));
        weekdays := case when freq = 'weekly' then
          coalesce((select array_agg(distinct d::smallint order by d::smallint)
                    from jsonb_array_elements_text(case when jsonb_typeof(e->'repeatWeekdays') = 'array'
                      then e->'repeatWeekdays' else '[]'::jsonb end) d),
                   array[extract(isodow from starts)::smallint])
          else '{}'::smallint[] end;
        if exists(select 1 from unnest(weekdays) d where d not between 1 and 7) then
          raise exception 'Некорректные дни недели' using errcode = '23514';
        end if;
        monthday := coalesce(nullif(e->>'repeatMonthday', '')::smallint, extract(day from starts)::smallint);
        ending := coalesce(e->>'repeatEndType',
          case when coalesce(e->>'end', '') <> '' then 'date' else 'never' end);
        until := case when ending = 'date' then nullif(e->>'end', '')::date end;
        repeat_count := case when ending = 'count' then nullif(e->>'repeatCount', '')::integer end;
        if ending = 'date' and until is null then ending := 'never'; end if;
        insert into public.recurrence_rules as r
          (id, pet_id, source_type, source_id, frequency, interval, days_of_week, day_of_month,
           starts_on, end_type, ends_on, occurrence_count, timezone)
        values (eid, pid, 'event', eid, freq, every_n, weekdays, monthday,
           starts, ending, until, repeat_count, coalesce(tz, 'Europe/Moscow'))
        on conflict (id) do update set frequency = excluded.frequency, interval = excluded.interval,
          days_of_week = excluded.days_of_week, day_of_month = excluded.day_of_month,
          starts_on = excluded.starts_on, end_type = excluded.end_type, ends_on = excluded.ends_on,
          occurrence_count = excluded.occurrence_count,
          timezone = coalesce(tz, r.timezone), updated_at = now()
        where r.pet_id = excluded.pet_id and r.source_type = 'event'
          and (r.frequency, r.interval, r.days_of_week, r.day_of_month, r.starts_on, r.end_type,
               r.ends_on, r.occurrence_count, r.timezone)
          is distinct from (excluded.frequency, excluded.interval, excluded.days_of_week,
               excluded.day_of_month, excluded.starts_on, excluded.end_type, excluded.ends_on,
               excluded.occurrence_count, coalesce(tz, r.timezone));
        if not exists(select 1 from public.recurrence_rules where id = eid and pet_id = pid and source_type = 'event') then
          raise exception 'Правило повторения принадлежит другому объекту' using errcode = '42501';
        end if;
      end if;

      insert into public.calendar_events as c
        (id, pet_id, type, category, title, comment, starts_on, time_of_day, timezone,
         recurrence_rule_id, linked_record, source, created_by, reminder_minutes, reminder_enabled, sort_order)
      values (eid, pid, coalesce(e->>'kind', 'event'), coalesce(e->>'category', 'care'), btrim(e->>'name'),
         coalesce(e->>'note', ''), starts, nullif(e->>'time', '')::time, coalesce(tz, 'Europe/Moscow'),
         case when freq <> 'once' then eid end, e->>'linkedRecord', 'native', actor,
         coalesce(e->>'reminder', '0')::integer, (e->>'reminderEnabled')::boolean, pos::integer)
      on conflict (id) do update set type = excluded.type, category = excluded.category,
        title = excluded.title, comment = excluded.comment, starts_on = excluded.starts_on,
        time_of_day = excluded.time_of_day, timezone = coalesce(tz, c.timezone),
        recurrence_rule_id = excluded.recurrence_rule_id, linked_record = excluded.linked_record,
        reminder_minutes = excluded.reminder_minutes, reminder_enabled = excluded.reminder_enabled,
        sort_order = excluded.sort_order, updated_at = now()
      where c.pet_id = excluded.pet_id
        and (c.type, c.category, c.title, c.comment, c.starts_on, c.time_of_day, c.timezone,
             c.recurrence_rule_id, c.linked_record, c.reminder_minutes, c.reminder_enabled, c.sort_order)
        is distinct from (excluded.type, excluded.category, excluded.title, excluded.comment,
             excluded.starts_on, excluded.time_of_day, coalesce(tz, c.timezone),
             excluded.recurrence_rule_id, excluded.linked_record, excluded.reminder_minutes,
             excluded.reminder_enabled, excluded.sort_order);
      -- The series no longer repeats: drop its rule.
      if freq = 'once' then
        delete from public.recurrence_rules where id = eid and pet_id = pid and source_type = 'event';
      end if;

      -- Exceptions: cancelled / moved / overridden occurrences of this event.
      if jsonb_typeof(e->'exceptions') = 'array' then
        if exists(select 1 from jsonb_array_elements(e->'exceptions') v
                  where coalesce(v->>'on', '') !~ '^\d{4}-\d{2}-\d{2}$'
                     or coalesce(v->>'newDate', '') !~ '^$|^\d{4}-\d{2}-\d{2}$'
                     or coalesce(v->>'time', '') !~ '^$|^([01]\d|2[0-3]):[0-5]\d$'
                     or (v ? 'name' and length(btrim(coalesce(v->>'name', ''))) not between 1 and 120)
                     or length(coalesce(v->>'note', '')) > 5000
                     or coalesce(v->>'kind', 'event') not in ('event', 'reminder')
                     or coalesce(v->>'category', 'care') not in ('care', 'training', 'health')) then
          raise exception 'Некорректное изменение события «%»', e->>'name' using errcode = '23514';
        end if;
        if (select count(*) <> count(distinct v->>'on') from jsonb_array_elements(e->'exceptions') v) then
          raise exception 'Повторяющиеся изменения одного события' using errcode = '23514';
        end if;
        delete from public.calendar_event_exceptions xe where xe.event_id = eid and xe.pet_id = pid
          and not exists(select 1 from jsonb_array_elements(e->'exceptions') v where (v->>'on')::date = xe.original_on);
        for x in select v from jsonb_array_elements(e->'exceptions') v loop
          override := (select coalesce(jsonb_object_agg(k, case when k = 'name' then to_jsonb(btrim(x->>k)) else x->k end), '{}'::jsonb)
                       from unnest(array['name','time','note','kind','category']) k where x ? k);
          insert into public.calendar_event_exceptions as xe (event_id, pet_id, original_on, moved_on, cancelled, override_payload)
          values (eid, pid, (x->>'on')::date, nullif(x->>'newDate', '')::date,
                  coalesce((x->>'cancelled')::boolean, false), override)
          on conflict (event_id, original_on) do update set moved_on = excluded.moved_on,
            cancelled = excluded.cancelled, override_payload = excluded.override_payload
          where (xe.moved_on, xe.cancelled, xe.override_payload)
            is distinct from (excluded.moved_on, excluded.cancelled, excluded.override_payload);
        end loop;
      else
        delete from public.calendar_event_exceptions where event_id = eid and pet_id = pid;
      end if;
    end loop;
  end if;

  if p_done is not null then
    if jsonb_typeof(p_done) <> 'object' then
      raise exception 'Некорректные отметки выполнения' using errcode = '23514';
    end if;
    delete from public.calendar_event_completions c where c.pet_id = pid
      and coalesce(p_done->>(c.event_id::text || ':' || c.occurrence_on::text), '') <> 'true';
    insert into public.calendar_event_completions(event_id, pet_id, occurrence_on, done)
    select lower(split_part(k.key, ':', 1))::uuid, pid, split_part(k.key, ':', 2)::date, true
    from jsonb_each_text(p_done) k
    where k.value = 'true'
      and k.key ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:\d{4}-\d{2}-\d{2}$'
      and exists(select 1 from public.calendar_events ce
                 where ce.id = lower(split_part(k.key, ':', 1))::uuid and ce.pet_id = pid)
    on conflict (event_id, occurrence_on) do nothing;
  end if;
end $$;

-- Occurrences of one event inside [from_day, to_day], computed on demand.
-- occurrence_on is the scheduled (original) day, on_day where it is shown.
create or replace function pet_private.event_occurrences(eid uuid, from_day date, to_day date)
returns table(occurrence_on date, on_day date, title text, category text, type text,
              time_of_day time, comment text)
language sql stable security definer set search_path = '' as $$
  with ev as (
    select e.* from public.calendar_events e where e.id = eid
  ),
  candidates as (
    select d::date as original from generate_series(from_day, to_day, interval '1 day') d
    union
    select x.original_on from public.calendar_event_exceptions x
    where x.event_id = eid and x.moved_on between from_day and to_day
  )
  select o.original,
         coalesce(x.moved_on, o.original),
         coalesce(x.override_payload->>'name', ev.title),
         coalesce(x.override_payload->>'category', ev.category),
         coalesce(x.override_payload->>'kind', ev.type),
         case when x.override_payload ? 'time' then nullif(x.override_payload->>'time', '')::time
              else ev.time_of_day end,
         coalesce(x.override_payload->>'note', ev.comment)
  from ev
  cross join candidates o
  left join public.calendar_event_exceptions x on x.event_id = ev.id and x.original_on = o.original
  where from_day <= to_day
    and case when ev.recurrence_rule_id is null then o.original = ev.starts_on
             else pet_private.recurrence_base(ev.recurrence_rule_id, o.original) end
    and not coalesce(x.cancelled, false)
    and coalesce(x.moved_on, o.original) between from_day and to_day
$$;

-- Public, range-limited view of a pet's calendar for the requested window.
create or replace function public.calendar_occurrences(p_pet uuid, p_from date, p_to date)
returns table(event_id uuid, occurrence_on date, on_day date, title text, category text, type text,
              time_of_day text, comment text, timezone text, starts_at timestamptz, done boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or p_pet is null or pet_private.member_role(p_pet) is null then
    raise exception 'Нет доступа к календарю питомца' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 400 then
    raise exception 'Диапазон календаря — не больше 400 дней' using errcode = '22023';
  end if;
  return query
  select e.id, o.occurrence_on, o.on_day, o.title, o.category, o.type,
         coalesce(to_char(o.time_of_day, 'HH24:MI'), ''), o.comment, e.timezone,
         (o.on_day + coalesce(o.time_of_day, time '00:00')) at time zone e.timezone,
         exists(select 1 from public.calendar_event_completions c
                where c.event_id = e.id and c.occurrence_on = o.on_day and c.done)
  from public.calendar_events e
  cross join lateral pet_private.event_occurrences(e.id, p_from, p_to) o
  where e.pet_id = p_pet
  order by o.on_day, o.time_of_day nulls first, e.sort_order, e.id;
end $$;

-- 6. Load: calendar comes from the tables, same JSON shape as before.
CREATE OR REPLACE FUNCTION pet_private.load_state()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare uid uuid:=auth.uid(); result jsonb; chosen text;
begin
 if uid is null then raise exception 'Требуется вход' using errcode='42501'; end if;
 perform pet_private.expand_training();
 select coalesce(jsonb_agg((p.data-'events'-'done')||jsonb_build_object('id',p.id,'shareCode',p.share_code,'role',m.role,'revision',p.revision,
 'events',pet_private.calendar_json(p.id),
 'done',pet_private.done_json(p.id),
 'trainingDiary',coalesce((select jsonb_agg(jsonb_build_object('source_key',d.source_key,'date',d.date,'status',d.status,'original_text',d.original_text,'session_id',d.session_id,'details',d.details) order by d.date desc,d.source_key) from public.training_diary d where d.pet_id=p.id),'[]'::jsonb),
 'pendingRequests',case when m.role='owner' then (select count(*) from public.pet_access_requests q where q.pet_id=p.id and q.status='pending') else 0 end,
 'trainingSchedules',coalesce((select jsonb_agg(to_jsonb(t)-'pet_id'-'created_by'-'created_at'-'updated_at'-'timezone'||jsonb_build_object('command_ids',coalesce((select jsonb_agg(c.command_id order by c.command_id) from public.training_schedule_commands c where c.schedule_id=t.id),'[]'::jsonb))) from public.training_schedules t where t.pet_id=p.id),'[]'::jsonb),
 'commands',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,'archived',c.archived) order by c.created_at,c.id) from public.commands c where c.pet_id=p.id),'[]'::jsonb),
 'workouts',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'date',s.date,'status',s.status,'scheduled_at',s.scheduled_at,'completed_at',s.completed_at,'name',s.name,'time',coalesce(to_char(s.time_of_day,'HH24:MI'),''),'schedule_id',s.schedule_id,'duration_minutes',s.duration_minutes,'comment',s.comment,'created_at',s.created_at,'updated_at',s.updated_at,
 'results',coalesce((select jsonb_agg(jsonb_build_object('command_id',r.command_id,'performance_score',r.performance_score,'mode',r.mode,'comment',r.comment) order by r.created_at,r.id) from public.training_session_commands r where r.training_session_id=s.id),'[]'::jsonb)) order by s.date desc,s.created_at desc) from public.training_sessions s where s.pet_id=p.id),'[]'::jsonb)) order by p.created_at,p.id),'[]'::jsonb)
 into result from public.pets p join public.pet_members m on m.pet_id=p.id
 where m.user_id=uid and m.status='active' and p.deleted_at is null;
 select selected_pet into chosen from public.account_state where user_id=uid;
 if not exists(select 1 from jsonb_array_elements(result) x where x->>'id'=chosen) then chosen=result->0->>'id'; end if;
 return jsonb_build_object('state',jsonb_build_object('version',1,'selectedPet',coalesce(chosen,''),'pets',result),'revision',0,'tag',(select md5(coalesce(jsonb_agg(jsonb_build_array(x->'id',x->'revision',x->'shareCode',x->'role',x->'pendingRequests') order by x->>'id')::text,'')) from jsonb_array_elements(result) x));
end $function$;

-- 7. Save: same contract; events/done are written to the calendar tables.
-- Changes vs. the previous version are marked with "calendar:".
CREATE OR REPLACE FUNCTION pet_private.save_state(changes jsonb, removed jsonb, selected_pet text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare uid uuid:=auth.uid(); owner_id uuid; item jsonb; p jsonb; c jsonb; s jsonb; r jsonb; pid uuid; sid uuid; existing public.pets; n integer; sc jsonb; changed boolean;cid uuid; previous_sc public.training_schedules;
begin
 if uid is null then raise exception 'Требуется вход' using errcode='42501'; end if;
 if jsonb_typeof(changes) is distinct from 'array' or jsonb_typeof(removed) is distinct from 'array' or jsonb_array_length(changes)>100 then raise exception 'Некорректные данные' using errcode='23514'; end if;
 -- Serialize against all membership changes and other writers, in a stable order.
 perform 1 from public.pets where id in (select (x->'pet'->>'id')::uuid from jsonb_array_elements(changes) x union select (x->>'id')::uuid from jsonb_array_elements(removed) x) order by id for update;
 for item in select * from jsonb_array_elements(changes) loop
  p=item->'pet';
  if p->>'trainingVersion' is distinct from '2' then raise exception 'Обновите приложение для работы с новым календарём' using errcode='PT409';end if;
 pid=(p->>'id')::uuid;
  if pid is null or length(btrim(p->>'name')) not between 1 and 120 or p->>'name' is null
   or jsonb_typeof(p->'commands') is distinct from 'array' or jsonb_typeof(p->'workouts') is distinct from 'array'
   then raise exception 'Некорректный питомец' using errcode='23514'; end if;
  if (select count(*)<>count(distinct x->>'id') from jsonb_array_elements(p->'commands') x) or (select count(*)<>count(distinct x->>'id') from jsonb_array_elements(p->'workouts') x) then raise exception 'Повторяющиеся команды или тренировки' using errcode='23514'; end if;
  select * into existing from public.pets where id=pid;
  if found then
   if pet_private.member_role(pid) is null then raise exception 'Доступ к питомцу отозван или отсутствует' using errcode='42501'; end if;
   if existing.revision is distinct from (item->>'revision')::bigint then raise exception 'Питомец изменён другим участником. Обновите данные перед сохранением.' using errcode='PT409'; end if;
   owner_id=existing.owner_user_id;
   -- calendar: events/done are no longer stored in pets.data
   update public.pets set data=p-'events'-'done'-'trainingVersion'-'trainingSchedules'-'trainingDiary'-'commands'-'workouts'-'shareCode'-'role'-'revision'-'pendingRequests',revision=revision+1,updated_at=now() where id=pid;
  else
   if item->>'revision' is not null then raise exception 'Питомец недоступен' using errcode='42501'; end if;
   owner_id=uid;
   loop begin
    insert into public.pets(id,owner_user_id,data) values(pid,uid,p-'events'-'done'-'trainingVersion'-'trainingSchedules'-'trainingDiary'-'commands'-'workouts'-'shareCode'-'role'-'revision'-'pendingRequests'); exit;
   exception when unique_violation then
    if exists(select 1 from public.pets where id=pid) then raise exception 'Такой питомец уже существует' using errcode='PT409'; end if;
   end; end loop;
   insert into public.pet_members(pet_id,user_id,role) values(pid,uid,'owner');
  end if;
  -- calendar: write the normalized calendar (skipped when the client says it is unchanged)
  if coalesce((item->>'updateCalendar')::boolean,true) then
   perform pet_private.store_calendar(pid,
     case when p ? 'events' then p->'events' end,
     case when p ? 'done' then p->'done' end,
     uid);
  end if;
  if coalesce((item->>'updateWorkouts')::boolean,true) then
  -- Remove results before replacing a training; the deferred constraint checks the final state.
  delete from public.training_session_commands r0 where r0.training_session_id in (select id from public.training_sessions where pet_id=pid) and not exists (
    select 1 from jsonb_array_elements(coalesce(p->'workouts','[]')) w, jsonb_array_elements(w->'results') x
    where w->>'id'=r0.training_session_id::text and x->>'command_id'=r0.command_id::text
  );
  delete from public.training_sessions where user_id=owner_id and pet_id=pid and id::text not in(select x->>'id' from jsonb_array_elements(coalesce(p->'workouts','[]')) x);
  if coalesce((item->>'updateCommands')::boolean,true) then
  update public.commands set archived=true where user_id=owner_id and pet_id=pid and id::text not in(select x->>'id' from jsonb_array_elements(p->'commands') x);
  for c in select * from jsonb_array_elements(p->'commands') loop
   insert into public.commands(id,pet_id,user_id,name,archived) values((c->>'id')::uuid,pid,owner_id,btrim(c->>'name'),coalesce((c->>'archived')::boolean,false))
    on conflict(id) do update set name=excluded.name,archived=case when c ? 'archived' then excluded.archived else public.commands.archived end
     where public.commands.pet_id=excluded.pet_id;
   if not found then raise exception 'Команда принадлежит другому питомцу' using errcode='23514'; end if;
  end loop;
  end if;
  for s in select * from jsonb_array_elements(coalesce(p->'workouts','[]')) loop
   if jsonb_typeof(s->'results') is distinct from 'array' or (coalesce(s->>'status','completed')='completed' and jsonb_array_length(s->'results')<1) then raise exception 'Выберите хотя бы одну команду' using errcode='23514'; end if;
   if (select count(*)<>count(distinct x->>'command_id') from jsonb_array_elements(s->'results') x) then raise exception 'Команда повторяется в тренировке' using errcode='23514'; end if;
   sid=(s->>'id')::uuid;
   if s->>'schedule_id' is not null and not exists(select 1 from public.training_schedules where id=(s->>'schedule_id')::uuid and pet_id=pid) then raise exception 'График другого питомца' using errcode='23514';end if;
   insert into public.training_sessions(id,pet_id,user_id,date,duration_minutes,comment,created_at,status,scheduled_at,completed_at,name,time_of_day,schedule_id,created_by)
    values(sid,pid,owner_id,(s->>'date')::date,(s->>'duration_minutes')::integer,coalesce(s->>'comment',''),coalesce((s->>'created_at')::timestamptz,now()),coalesce(s->>'status','completed'),(s->>'scheduled_at')::timestamptz,case when coalesce(s->>'status','completed')='completed' then coalesce((s->>'completed_at')::timestamptz,((s->>'date')::date+time '12:00') at time zone 'Europe/Moscow') else null end,coalesce(s->>'name',''),nullif(s->>'time','')::time,(s->>'schedule_id')::uuid,uid)
    on conflict(id) do update set date=excluded.date,duration_minutes=excluded.duration_minutes,comment=excluded.comment,status=excluded.status,scheduled_at=excluded.scheduled_at,completed_at=excluded.completed_at,name=excluded.name,time_of_day=excluded.time_of_day
     where public.training_sessions.pet_id=excluded.pet_id and
      (public.training_sessions.date,public.training_sessions.duration_minutes,public.training_sessions.comment,public.training_sessions.status,public.training_sessions.scheduled_at,public.training_sessions.completed_at,public.training_sessions.name,public.training_sessions.time_of_day) is distinct from
      (excluded.date,excluded.duration_minutes,excluded.comment,excluded.status,excluded.scheduled_at,excluded.completed_at,excluded.name,excluded.time_of_day);
   if not found and not exists (select 1 from public.training_sessions where id=sid and pet_id=pid) then raise exception 'Тренировка принадлежит другому питомцу' using errcode='23514'; end if;
   for r in select * from jsonb_array_elements(s->'results') loop
    insert into public.training_session_commands(training_session_id,command_id,performance_score,mode,comment)
     values(sid,(r->>'command_id')::uuid,(r->>'performance_score')::integer,coalesce(r->>'mode','repeat'),coalesce(r->>'comment',''))
     on conflict(training_session_id,command_id) do update set performance_score=excluded.performance_score,mode=excluded.mode,comment=excluded.comment
      where (public.training_session_commands.performance_score,public.training_session_commands.mode,public.training_session_commands.comment) is distinct from (excluded.performance_score,excluded.mode,excluded.comment);
   end loop;
  end loop;

  end if;
  if coalesce((item->>'updateSchedules')::boolean,true) and p ? 'trainingSchedules' then
   if jsonb_typeof(p->'trainingSchedules')<>'array' then raise exception 'Некорректный график' using errcode='23514';end if;
   for sc in select * from jsonb_array_elements(p->'trainingSchedules') loop
    select * into previous_sc from public.training_schedules
      where id=(sc->>'id')::uuid and pet_id=pid;
    if exists(select 1 from public.training_schedules where id=(sc->>'id')::uuid and pet_id<>pid) then raise exception 'График другого питомца' using errcode='42501';end if;
    changed=not exists(select 1 from public.training_schedules t where t.id=(sc->>'id')::uuid and
      (t.name,t.time_of_day,t.repeat_type,to_jsonb(t.weekdays),t.starts_on,t.ends_on,t.is_active,t.comment,t.recurrence_frequency,t.recurrence_interval,t.recurrence_end_type,t.recurrence_count,t.recurrence_monthday) is not distinct from
      (coalesce(sc->>'name',''),nullif(sc->>'time_of_day','')::time,sc->>'repeat_type',sc->'weekdays',(sc->>'starts_on')::date,(sc->>'ends_on')::date,(sc->>'is_active')::boolean,coalesce(sc->>'comment',''),sc->>'recurrence_frequency',coalesce((sc->>'recurrence_interval')::integer,1),sc->>'recurrence_end_type',(sc->>'recurrence_count')::integer,(sc->>'recurrence_monthday')::smallint)
      and (select coalesce(jsonb_agg(c.command_id::text order by c.command_id::text),'[]') from public.training_schedule_commands c where c.schedule_id=t.id)=(select coalesce(jsonb_agg(x order by x),'[]') from jsonb_array_elements_text(sc->'command_ids') x));
    insert into public.training_schedules(id,pet_id,name,time_of_day,repeat_type,weekdays,starts_on,ends_on,is_active,comment,created_by,recurrence_frequency,recurrence_interval,recurrence_end_type,recurrence_count,recurrence_monthday)
    values((sc->>'id')::uuid,pid,coalesce(sc->>'name',''),nullif(sc->>'time_of_day','')::time,sc->>'repeat_type',array(select x::smallint from jsonb_array_elements_text(sc->'weekdays') x),(sc->>'starts_on')::date,(sc->>'ends_on')::date,(sc->>'is_active')::boolean,coalesce(sc->>'comment',''),uid,sc->>'recurrence_frequency',coalesce((sc->>'recurrence_interval')::integer,1),sc->>'recurrence_end_type',(sc->>'recurrence_count')::integer,(sc->>'recurrence_monthday')::smallint)
    on conflict(id) do update set name=excluded.name,time_of_day=excluded.time_of_day,repeat_type=excluded.repeat_type,weekdays=excluded.weekdays,starts_on=excluded.starts_on,ends_on=excluded.ends_on,is_active=excluded.is_active,comment=excluded.comment,
      recurrence_frequency=excluded.recurrence_frequency,recurrence_interval=excluded.recurrence_interval,
      recurrence_end_type=excluded.recurrence_end_type,recurrence_count=excluded.recurrence_count,
      recurrence_monthday=excluded.recurrence_monthday;
    if changed then
     if previous_sc.id is not null
       and sc->>'recurrence_end_type' = 'date'
       and (sc->>'ends_on') is not null
       and (sc->>'ends_on')::date < coalesce(previous_sc.ends_on,'infinity'::date)
       and previous_sc.starts_on = (sc->>'starts_on')::date
       and previous_sc.recurrence_frequency = sc->>'recurrence_frequency'
       and previous_sc.recurrence_interval = coalesce((sc->>'recurrence_interval')::integer,1)
       and previous_sc.repeat_type = sc->>'repeat_type'
       and to_jsonb(previous_sc.weekdays) = sc->'weekdays'
       and previous_sc.time_of_day is not distinct from nullif(sc->>'time_of_day','')::time
       and previous_sc.name = coalesce(sc->>'name','')
       and previous_sc.comment = coalesce(sc->>'comment','')
       and previous_sc.is_active = coalesce((sc->>'is_active')::boolean,true)
     then
       -- Only truncate this schedule: keep all earlier planned instances and IDs.
       delete from public.training_sessions
       where schedule_id=(sc->>'id')::uuid and status='planned'
         and date>(sc->>'ends_on')::date;
     else
       -- Editing the actual recurrence pattern requires rebuilding upcoming instances.
       delete from public.training_sessions where schedule_id=(sc->>'id')::uuid and status='planned' and date>=current_date;
     end if;
     delete from public.training_schedule_commands where schedule_id=(sc->>'id')::uuid;
     for cid in select value::uuid from jsonb_array_elements_text(sc->'command_ids') loop
      if not exists(select 1 from public.commands where id=cid and pet_id=pid) then raise exception 'Команда другого питомца' using errcode='23514';end if;
      insert into public.training_schedule_commands values((sc->>'id')::uuid,cid) on conflict do nothing;
     end loop;
    end if;
   end loop;
  end if;
 end loop;
 for item in select * from jsonb_array_elements(removed) loop
  pid=(item->>'id')::uuid;
  if pet_private.member_role(pid) is distinct from 'owner' then raise exception 'Удалять питомца может только владелец' using errcode='42501'; end if;
  if (select revision from public.pets where id=pid) is distinct from (item->>'revision')::bigint then raise exception 'Данные изменились. Обновите приложение.' using errcode='PT409'; end if;
  update public.pets set deleted_at=now(),revision=revision+1 where id=pid;
 end loop;
 insert into public.account_state(user_id,selected_pet) values(uid,selected_pet)
 on conflict(user_id) do update set selected_pet=excluded.selected_pet;
 return pet_private.load_state();
end $function$;

-- 8. Push: occurrences (incl. moved / overridden ones) come from the shared engine.
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
     e.timezone
   from public.event_reminders rem
   join public.calendar_events e on e.id=rem.event_id and e.pet_id=rem.pet_id
   join public.pet_members origin on origin.pet_id=rem.pet_id and origin.user_id=rem.user_id
     and origin.status='active'
   order by rem.event_id,rem.updated_at desc,rem.id desc
 ),
 active_reminders as (
   select cfg.reminder_id,member.user_id,cfg.event_id,cfg.pet_id,cfg.timezone,
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
   select ar.*, o.occurrence_on,
      -- Local wall-clock time in the event's IANA zone; DST is resolved here.
      ((o.on_day+coalesce(o.time_of_day,time '09:00'))
        at time zone ar.timezone) as occurrence_at
   from active_reminders ar
   cross join lateral pet_private.event_occurrences(ar.event_id,
     ((moment+(ar.offset_minutes*interval '1 minute')) at time zone ar.timezone)::date-1,
     ((moment+(ar.offset_minutes*interval '1 minute')) at time zone ar.timezone)::date+1) o
 ),
 due as (
 select o.user_id,o.event_id,o.occurrence_at,o.reminder_id,o.occurrence_on
 from occurrences o
 where o.occurrence_at-(o.offset_minutes*interval '1 minute')
         >= moment-interval '2 minutes'
   and o.occurrence_at-(o.offset_minutes*interval '1 minute')
         <= moment+interval '1 minute'
 )
 insert into public.notification_deliveries(user_id,event_id,occurrence_at,reminder_id,occurrence_on)
 select user_id,event_id,occurrence_at,reminder_id,occurrence_on from due
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
 returning d.id,d.user_id,d.event_id,d.reminder_id,d.occurrence_at,d.occurrence_on
)
select c.id,c.user_id,c.event_id,c.reminder_id,c.occurrence_at,
       coalesce(x.override_payload->>'name',e.title),
       coalesce(x.override_payload->>'note',e.comment),
       e.timezone
from claimed c join public.calendar_events e on e.id=c.event_id
left join public.calendar_event_exceptions x on x.event_id=c.event_id and x.original_on=c.occurrence_on
$function$;

-- 9. Transfer every pet's JSON calendar into the tables, verify, then clear it.
-- Canonical form of an event/exception list, used only for verification:
-- fills the same defaults the client applies, so equal canon = same calendar.
create or replace function pet_private.canonical_calendar(events jsonb)
returns jsonb language sql immutable security invoker set search_path = '' as $$
  select coalesce(jsonb_agg(c order by c->>'id'), '[]'::jsonb) from (
    select jsonb_strip_nulls(jsonb_build_object(
      'id', lower(v->>'id'),
      'name', btrim(v->>'name'),
      'category', coalesce(v->>'category', 'care'),
      'kind', coalesce(v->>'kind', 'event'),
      'date', v->>'date',
      'time', coalesce(v->>'time', ''),
      'note', coalesce(v->>'note', ''),
      'reminder', coalesce(v->>'reminder', '0')::integer,
      'reminderEnabled', (v->>'reminderEnabled')::boolean,
      'linkedRecord', v->>'linkedRecord',
      'repeat', rep,
      'interval', case when rep <> 'once' then greatest(1, least(366, coalesce(nullif(v->>'repeatInterval', '')::integer, 1))) end,
      'weekdays', case when rep = 'weekly' then coalesce(
          (select jsonb_agg(distinct d::integer order by d::integer)
           from jsonb_array_elements_text(case when jsonb_typeof(v->'repeatWeekdays') = 'array' then v->'repeatWeekdays' else '[]' end) d),
          jsonb_build_array(extract(isodow from (v->>'date')::date)::integer)) end,
      'monthday', case when rep = 'monthly' then coalesce(nullif(v->>'repeatMonthday', '')::integer, extract(day from (v->>'date')::date)::integer) end,
      'endType', case when rep <> 'once' then end_type end,
      'end', case when rep <> 'once' and end_type = 'date' then v->>'end' end,
      'count', case when rep <> 'once' and end_type = 'count' then (v->>'repeatCount')::integer end,
      'exceptions', (select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
            'on', x->>'on', 'newDate', nullif(x->>'newDate', ''),
            'cancelled', case when coalesce((x->>'cancelled')::boolean, false) then true end,
            'name', btrim(x->>'name'), 'time', x->>'time', 'note', x->>'note',
            'kind', x->>'kind', 'category', x->>'category')) order by x->>'on')
          from jsonb_array_elements(case when jsonb_typeof(v->'exceptions') = 'array' then v->'exceptions' else '[]' end) x)
    )) as c
    from jsonb_array_elements(coalesce(events, '[]'::jsonb)) v,
    lateral (select coalesce(v->>'repeat', 'once') as rep) r1,
    lateral (select case when coalesce(v->>'repeatEndType', '') <> '' then
                      case when v->>'repeatEndType' = 'date' and coalesce(v->>'end', '') = '' then 'never' else v->>'repeatEndType' end
                    when coalesce(v->>'end', '') <> '' then 'date' else 'never' end as end_type) r2
  ) q
$$;

create or replace function pet_private.canonical_done(done jsonb, events jsonb)
returns jsonb language sql immutable security invoker set search_path = '' as $$
  select coalesce(jsonb_object_agg(lower(k.key), true), '{}'::jsonb)
  from jsonb_each_text(case when jsonb_typeof(done) = 'object' then done else '{}' end) k
  where k.value = 'true'
    and exists(select 1 from jsonb_array_elements(coalesce(events, '[]'::jsonb)) v
               where lower(v->>'id') = lower(split_part(k.key, ':', 1)))
$$;

do $transfer$
declare p record; mismatched text[] := '{}';
begin
  for p in select id, owner_user_id, data from public.pets order by id loop
    perform pet_private.store_calendar(p.id,
      case when jsonb_typeof(p.data->'events') = 'array' then p.data->'events' else '[]'::jsonb end,
      case when jsonb_typeof(p.data->'done') = 'object' then p.data->'done' else '{}'::jsonb end,
      p.owner_user_id);
    if pet_private.canonical_calendar(p.data->'events')
         is distinct from pet_private.canonical_calendar(pet_private.calendar_json(p.id))
       or pet_private.canonical_done(p.data->'done', p.data->'events')
         is distinct from pet_private.done_json(p.id) then
      mismatched := mismatched || p.id::text;
    end if;
  end loop;
  if cardinality(mismatched) > 0 then
    raise exception 'Calendar transfer verification failed for pets: %', mismatched;
  end if;
  update public.pets set data = data - 'events' - 'done' where data ? 'events' or data ? 'done';
end $transfer$;

-- 10. Privileges.
revoke all on function pet_private.valid_timezone(text), pet_private.calendar_json(uuid),
  pet_private.done_json(uuid), pet_private.store_calendar(uuid, jsonb, jsonb, uuid),
  pet_private.event_occurrences(uuid, date, date), pet_private.canonical_calendar(jsonb),
  pet_private.canonical_done(jsonb, jsonb)
  from public, anon, authenticated;
revoke all on function public.calendar_occurrences(uuid, date, date) from public, anon;
grant execute on function public.calendar_occurrences(uuid, date, date) to authenticated;
