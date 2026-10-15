
-- Keep legacy clients working while maintaining a normalized relational mirror.
-- No existing pet JSON or completed training history is deleted.
create or replace function pet_private.recurrence_base(rule_id uuid, on_day date)
returns boolean language plpgsql stable security invoker set search_path='' as $$
declare r public.recurrence_rules; elapsed integer; step integer; w integer;
  week_idx integer; days smallint[]; count_before integer; month_idx integer;
  last_day integer; desired integer; first_skip integer; seq integer; yy integer; mm integer; dd integer;
begin
 select * into r from public.recurrence_rules where id=rule_id;
 if not found or on_day<r.starts_on then return false; end if;
 if r.end_type='date' and on_day>r.ends_on then return false;end if;
 step=r.interval;elapsed=on_day-r.starts_on;
 if r.frequency='daily' then
  if mod(elapsed,step)<>0 then return false;end if;
  seq=elapsed/step+1;
 elsif r.frequency='weekly' then
  days=case when cardinality(r.days_of_week)>0 then r.days_of_week else array[extract(isodow from r.starts_on)::smallint] end;
  days=(select array_agg(x order by x) from (select distinct unnest(days) x) q);
  w=extract(isodow from r.starts_on)::int;
  week_idx=floor((elapsed+w-1)::numeric/7)::integer;
  if mod(week_idx,step)<>0 or not extract(isodow from on_day)::smallint=any(days) then return false;end if;
  if week_idx=0 then
   seq=(select count(*) from unnest(days) x where x>=w and x<=extract(isodow from on_day));
   if seq=0 then return false;end if;
  else
   count_before=(select count(*) from unnest(days) x where x>=w);
   seq=count_before+(week_idx/step-1)*cardinality(days)
     +(select count(*) from unnest(days) x where x<=extract(isodow from on_day));
  end if;
 elsif r.frequency='monthly' then
  month_idx=(extract(year from on_day)::int-extract(year from r.starts_on)::int)*12+
    extract(month from on_day)::int-extract(month from r.starts_on)::int;
  if mod(month_idx,step)<>0 then return false;end if;
  desired=coalesce(r.day_of_month,extract(day from r.starts_on)::int);
  last_day=extract(day from (date_trunc('month',on_day)+interval '1 month - 1 day'))::int;
  if extract(day from on_day)::int<>least(desired,last_day) then return false;end if;
  first_skip=case when least(desired,extract(day from (date_trunc('month',r.starts_on)+interval '1 month - 1 day'))::int)<extract(day from r.starts_on)::int then 1 else 0 end;
  seq=month_idx/step+1-first_skip;
 elsif r.frequency='yearly' then
  yy=extract(year from on_day)::int-extract(year from r.starts_on)::int;
  if mod(yy,step)<>0 or extract(month from on_day)<>extract(month from r.starts_on) then return false;end if;
  mm=extract(month from r.starts_on)::int;
  dd=extract(day from r.starts_on)::int;
  last_day=extract(day from (date_trunc('month',on_day)+interval '1 month - 1 day'))::int;
  if extract(day from on_day)::int<>least(dd,last_day) then return false;end if;
  seq=yy/step+1;
 else return false;end if;
 return seq>0 and (r.end_type<>'count' or seq<=r.occurrence_count);
end $$;

create or replace function pet_private.recurrence_occurs(rule_id uuid, on_day date)
returns boolean language plpgsql stable security invoker set search_path='' as $$
declare r public.recurrence_rules; changed boolean;
begin
 select * into r from public.recurrence_rules where id=rule_id;
 if not found then return false;end if;
 if r.source_type='event' then
  select true into changed from public.calendar_event_exceptions x
   where x.event_id=r.source_id and x.moved_on=on_day and not x.cancelled
   and x.original_on<>on_day and pet_private.recurrence_base(rule_id,x.original_on) limit 1;
  if coalesce(changed,false) then return true;end if;
 end if;
 if not pet_private.recurrence_base(rule_id,on_day) then return false;end if;
 if r.source_type='event' and exists(
   select 1 from public.calendar_event_exceptions x
   where x.event_id=r.source_id and x.original_on=on_day
     and (x.cancelled or (x.moved_on is not null and x.moved_on<>on_day))
 ) then return false;end if;
 return true;
end $$;

create or replace function pet_private.sync_calendar(pid uuid, snapshot jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare entry jsonb; completed record; owner_id uuid; eid uuid; rec_id uuid;
 frequency text; every_n integer; target_day smallint; repeat_end text; next_days smallint[];
begin
 select owner_user_id into owner_id from public.pets where id=pid;
 if owner_id is null then return;end if;
 if jsonb_typeof(snapshot->'events') is distinct from 'array' then return;end if;
 for entry in select value from jsonb_array_elements(snapshot->'events') loop
  if coalesce(entry->>'id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then continue;end if;
  eid=(entry->>'id')::uuid;
  frequency=coalesce(entry->>'repeat','once');
  rec_id=case when frequency='once' then null else eid end;
  if rec_id is not null then
   every_n=greatest(1,least(366,coalesce(nullif(entry->>'repeatInterval','')::integer,1)));
   target_day=coalesce((entry->>'repeatMonthday')::smallint,extract(day from (entry->>'date')::date)::smallint);
   next_days=case when jsonb_typeof(entry->'repeatWeekdays')='array'
     then array(select x::smallint from jsonb_array_elements_text(entry->'repeatWeekdays') x)
     when frequency='weekly' then array[extract(isodow from (entry->>'date')::date)::smallint]
     else '{}'::smallint[] end;
   repeat_end=coalesce(entry->>'repeatEndType',case when nullif(entry->>'end','') is not null then 'date' else 'never' end);
   insert into public.recurrence_rules(id,pet_id,source_type,source_id,frequency,interval,days_of_week,day_of_month,starts_on,end_type,ends_on,occurrence_count,timezone)
   values(rec_id,pid,'event',eid,frequency,every_n,next_days,target_day,(entry->>'date')::date,repeat_end,
     case when repeat_end='date' then nullif(entry->>'end','')::date else null end,
     case when repeat_end='count' then (entry->>'repeatCount')::integer else null end,
     coalesce(nullif(entry->>'timezone',''),'Europe/Moscow'))
   on conflict(id) do update set frequency=excluded.frequency,interval=excluded.interval,
     days_of_week=excluded.days_of_week,day_of_month=excluded.day_of_month,
     starts_on=excluded.starts_on,end_type=excluded.end_type,ends_on=excluded.ends_on,
     occurrence_count=excluded.occurrence_count,timezone=excluded.timezone,updated_at=now()
   where public.recurrence_rules.pet_id=excluded.pet_id and public.recurrence_rules.source_type='event';
  end if;
  insert into public.calendar_events(id,pet_id,type,category,title,comment,starts_on,time_of_day,timezone,recurrence_rule_id,linked_record,source,legacy_payload,created_by)
   values(eid,pid,case when entry->>'kind'='reminder' then 'reminder' else 'event' end,
    coalesce(entry->>'category','care'),coalesce(entry->>'name','Событие'),
    coalesce(entry->>'note',''),(entry->>'date')::date,
    nullif(entry->>'time','')::time,coalesce(nullif(entry->>'timezone',''),'Europe/Moscow'),
    rec_id,entry->>'linkedRecord','legacy',entry,owner_id)
   on conflict(id) do update set type=excluded.type,category=excluded.category,
     title=excluded.title,comment=excluded.comment,starts_on=excluded.starts_on,
     time_of_day=excluded.time_of_day,timezone=excluded.timezone,
     recurrence_rule_id=excluded.recurrence_rule_id,linked_record=excluded.linked_record,
     legacy_payload=excluded.legacy_payload,updated_at=now()
   where public.calendar_events.pet_id=excluded.pet_id and public.calendar_events.source='legacy';
  delete from public.calendar_event_exceptions where event_id=eid and pet_id=pid;
  if jsonb_typeof(entry->'exceptions')='array' then
   insert into public.calendar_event_exceptions(event_id,pet_id,original_on,moved_on,cancelled)
   select eid,pid,(x->>'on')::date,nullif(x->>'newDate','')::date,
     coalesce((x->>'cancelled')::boolean,false)
   from jsonb_array_elements(entry->'exceptions') x
   where x ? 'on' on conflict(event_id,original_on) do update
   set moved_on=excluded.moved_on,cancelled=excluded.cancelled;
  end if;
 end loop;
 delete from public.calendar_events e where e.pet_id=pid and e.source='legacy'
  and not exists(select 1 from jsonb_array_elements(snapshot->'events') x where x->>'id'=e.id::text);
 delete from public.recurrence_rules r where r.pet_id=pid and r.source_type='event'
  and not exists(select 1 from public.calendar_events e where e.id=r.source_id and e.recurrence_rule_id=r.id);
 delete from public.calendar_event_completions where pet_id=pid;
 if jsonb_typeof(snapshot->'done')='object' then
   insert into public.calendar_event_completions(event_id,pet_id,occurrence_on,done)
   select (split_part(k.key,':',1))::uuid,pid,
     (split_part(k.key,':',2))::date,true
   from jsonb_each_text(snapshot->'done') k
   where k.value='true' and k.key ~* '^[0-9a-f-]{36}:[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    and exists(select 1 from public.calendar_events e where e.id::text=split_part(k.key,':',1) and e.pet_id=pid)
   on conflict do nothing;
 end if;
end $$;

create or replace function pet_private.sync_pet_calendar_trigger()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 perform pet_private.sync_calendar(new.id,new.data);
 return new;
end $$;
drop trigger if exists pet_calendar_mirror on public.pets;
create trigger pet_calendar_mirror after insert or update of data on public.pets
for each row execute function pet_private.sync_pet_calendar_trigger();
do $$
declare p record;
begin
 for p in select id,data from public.pets loop
  perform pet_private.sync_calendar(p.id,p.data);
 end loop;
end $$;
revoke all on function pet_private.sync_calendar(uuid,jsonb),
pet_private.sync_pet_calendar_trigger(),pet_private.recurrence_base(uuid,date),
pet_private.recurrence_occurs(uuid,date) from public,anon,authenticated;
