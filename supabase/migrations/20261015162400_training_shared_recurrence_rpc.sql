-- Production migration applied 2026-10-15; preserves existing sessions and results.
alter table public.training_schedules
 add column if not exists recurrence_frequency text check(recurrence_frequency in ('daily','weekly','monthly','yearly')),
 add column if not exists recurrence_interval integer not null default 1 check(recurrence_interval between 1 and 366),
 add column if not exists recurrence_end_type text check(recurrence_end_type in ('never','date','count')),
 add column if not exists recurrence_count integer check(recurrence_count between 1 and 10000),
 add column if not exists recurrence_monthday smallint check(recurrence_monthday between 1 and 31);

create or replace function pet_private.sync_training_rule()
returns trigger language plpgsql security definer set search_path='' as $train$
declare frequency text; days smallint[]; ending text;
begin
 if tg_op='DELETE' then
  delete from public.recurrence_rules where source_type='training' and source_id=old.id;
  return old;
 end if;
 frequency=coalesce(new.recurrence_frequency,case when new.repeat_type='daily' then 'daily' else 'weekly' end);
 days=case when frequency='weekly' then
   case when new.repeat_type='weekdays' or cardinality(new.weekdays)>0 then new.weekdays
     else array[extract(isodow from new.starts_on)::smallint] end
   else '{}'::smallint[] end;
 ending=coalesce(new.recurrence_end_type,case when new.ends_on is not null then 'date' else 'never' end);
 insert into public.recurrence_rules
 (id,pet_id,source_type,source_id,frequency,interval,days_of_week,day_of_month,starts_on,end_type,ends_on,occurrence_count,timezone)
 values(new.id,new.pet_id,'training',new.id,frequency,new.recurrence_interval,days,new.recurrence_monthday,new.starts_on,ending,
   case when ending='date' then new.ends_on else null end,
   case when ending='count' then new.recurrence_count else null end,new.timezone)
 on conflict(id) do update set frequency=excluded.frequency,interval=excluded.interval,
 days_of_week=excluded.days_of_week,day_of_month=excluded.day_of_month,
 starts_on=excluded.starts_on,end_type=excluded.end_type,ends_on=excluded.ends_on,
 occurrence_count=excluded.occurrence_count,timezone=excluded.timezone,updated_at=now()
 where public.recurrence_rules.pet_id=excluded.pet_id and public.recurrence_rules.source_type='training';
 return new;
end $train$;
drop trigger if exists training_rule_mirror on public.training_schedules;
create trigger training_rule_mirror after insert or update of
 starts_on,ends_on,repeat_type,weekdays,timezone,recurrence_frequency,
 recurrence_interval,recurrence_end_type,recurrence_count,recurrence_monthday
or delete on public.training_schedules
for each row execute function pet_private.sync_training_rule();

-- Recreate both RPC functions from their current definitions, replacing only
-- the recurrence-aware parts. Exact anchors force rollback when schema drifts.
do $patch$
declare savesql text; expand text; a text; b text;
begin
 select pg_get_functiondef('pet_private.expand_training()'::regprocedure) into expand;
 a=$a$sc.repeat_type='daily' or (sc.repeat_type='weekly' and extract(isodow from d)=extract(isodow from sc.starts_on)) or (sc.repeat_type='weekdays' and extract(isodow from d)::smallint=any(sc.weekdays))$a$;
 if position(a in expand)=0 then raise exception 'Training expansion patch anchor missing';end if;
 execute replace(expand,a,'pet_private.recurrence_occurs(sc.id,d)');
 select pg_get_functiondef('pet_private.save_state(jsonb,jsonb,text)'::regprocedure) into savesql;
 a=$a$(t.name,t.time_of_day,t.repeat_type,to_jsonb(t.weekdays),t.starts_on,t.ends_on,t.is_active,t.comment)$a$;
 b=$a$(t.name,t.time_of_day,t.repeat_type,to_jsonb(t.weekdays),t.starts_on,t.ends_on,t.is_active,t.comment,t.recurrence_frequency,t.recurrence_interval,t.recurrence_end_type,t.recurrence_count,t.recurrence_monthday)$a$;
 if position(a in savesql)=0 then raise exception 'Schedule comparison anchor missing';end if;
 savesql=replace(savesql,a,b);
 a=$a$(coalesce(sc->>'name',''),nullif(sc->>'time_of_day','')::time,sc->>'repeat_type',sc->'weekdays',(sc->>'starts_on')::date,(sc->>'ends_on')::date,(sc->>'is_active')::boolean,coalesce(sc->>'comment',''))$a$;
 b=$a$(coalesce(sc->>'name',''),nullif(sc->>'time_of_day','')::time,sc->>'repeat_type',sc->'weekdays',(sc->>'starts_on')::date,(sc->>'ends_on')::date,(sc->>'is_active')::boolean,coalesce(sc->>'comment',''),sc->>'recurrence_frequency',coalesce((sc->>'recurrence_interval')::integer,1),sc->>'recurrence_end_type',(sc->>'recurrence_count')::integer,(sc->>'recurrence_monthday')::smallint)$a$;
 if position(a in savesql)=0 then raise exception 'Schedule values comparison anchor missing';end if;
 savesql=replace(savesql,a,b);
 a='insert into public.training_schedules(id,pet_id,name,time_of_day,repeat_type,weekdays,starts_on,ends_on,is_active,comment,created_by)';
 b='insert into public.training_schedules(id,pet_id,name,time_of_day,repeat_type,weekdays,starts_on,ends_on,is_active,comment,created_by,recurrence_frequency,recurrence_interval,recurrence_end_type,recurrence_count,recurrence_monthday)';
 if position(a in savesql)=0 then raise exception 'Schedule insert anchor missing';end if;
 savesql=replace(savesql,a,b);
 a=$a$coalesce(sc->>'comment',''),uid)
    on conflict(id) do update set name=excluded.name$a$;
 b=$a$coalesce(sc->>'comment',''),uid,sc->>'recurrence_frequency',coalesce((sc->>'recurrence_interval')::integer,1),sc->>'recurrence_end_type',(sc->>'recurrence_count')::integer,(sc->>'recurrence_monthday')::smallint)
    on conflict(id) do update set name=excluded.name$a$;
 if position(a in savesql)=0 then raise exception 'Schedule insert values anchor missing';end if;
 savesql=replace(savesql,a,b);
 a=$a$ends_on=excluded.ends_on,is_active=excluded.is_active,comment=excluded.comment;$a$;
 b=$a$ends_on=excluded.ends_on,is_active=excluded.is_active,comment=excluded.comment,
 recurrence_frequency=excluded.recurrence_frequency,recurrence_interval=excluded.recurrence_interval,
 recurrence_end_type=excluded.recurrence_end_type,recurrence_count=excluded.recurrence_count,
 recurrence_monthday=excluded.recurrence_monthday;$a$;
 if position(a in savesql)=0 then raise exception 'Schedule update anchor missing';end if;
 execute replace(savesql,a,b);
end $patch$;

update public.training_schedules set recurrence_interval=recurrence_interval;
revoke all on function pet_private.sync_training_rule() from public,anon,authenticated;
