do $migration$ declare applied boolean; begin
if to_regclass('pet_private.data_migrations') is not null then
 execute 'select exists(select 1 from pet_private.data_migrations where name=''training_planning_v2'')' into applied;
 if applied then return;end if;end if;
execute $training$

-- Training source-of-truth migration. Preserve legacy user_state and all historical values.
create table if not exists pet_private.data_migrations(name text primary key,applied_at timestamptz not null default now());
alter table pet_private.data_migrations enable row level security;
revoke all on pet_private.data_migrations from public,anon,authenticated;
create temporary table training_before on commit drop as
select (select count(*) from public.pets) pets,(select count(*) from public.commands) commands,
(select count(*) from public.training_sessions) sessions,(select count(*) from public.training_command_results) results,
(select md5(string_agg(jsonb_build_array(id,pet_id,date,duration_minutes,comment,created_at)::text,'' order by id)) from public.training_sessions) session_hash,
(select md5(string_agg(jsonb_build_array(id,training_session_id,command_id,performance_score,comment,mode,created_at)::text,'' order by id)) from public.training_command_results) result_hash;
drop trigger training_nonempty on public.training_sessions;
drop trigger result_nonempty on public.training_command_results;
drop trigger result_touch_training on public.training_command_results;
drop policy results_member_read on public.training_command_results;
do $x$ declare r record;begin
 for r in select conname from pg_constraint where conrelid='public.training_command_results'::regclass and contype in ('f','u') loop
 execute format('alter table public.training_command_results drop constraint %I',r.conname);end loop;
end $x$;
-- UUIDs in this installation have already been verified. Abort rather than remap an unknown identifier silently.
alter table public.commands alter column id type uuid using id::uuid;
alter table public.commands add constraint commands_id_unique unique(id);
alter table public.training_sessions add constraint training_id_unique unique(id);
alter table public.commands add column updated_at timestamptz not null default now(),add column archived_at timestamptz;
update public.commands set updated_at=created_at,archived_at=case when archived then now() end;
drop index public.command_unique_name;
create unique index command_active_name on public.commands(pet_id,lower(btrim(name))) where archived_at is null;
alter table public.training_command_results rename to training_session_commands;
alter table public.training_session_commands alter column command_id type uuid using command_id::uuid;
alter table public.training_session_commands drop column pet_id,drop column user_id;
alter table public.training_session_commands alter column performance_score drop not null;
alter table public.training_session_commands alter column performance_score type smallint;
alter table public.commands drop constraint commands_pkey;
alter table public.commands add primary key(id);
alter table public.training_sessions drop constraint training_sessions_pkey;
alter table public.training_sessions add primary key(id);
alter table public.training_session_commands add column updated_at timestamptz not null default now();
update public.training_session_commands set updated_at=created_at;
alter table public.training_session_commands add foreign key(training_session_id) references public.training_sessions(id) on delete cascade,
add foreign key(command_id) references public.commands(id) on delete restrict,
add unique(training_session_id,command_id);
create index training_result_command on public.training_session_commands(command_id);
create policy results_member_read on public.training_session_commands for select to authenticated using(exists(select 1 from public.training_sessions s where s.id=training_session_id and pet_private.member_role(s.pet_id) is not null));

create table public.training_schedules(
 id uuid primary key,pet_id uuid not null references public.pets(id) on delete cascade,
 name text not null default '' check(length(name)<=120),time_of_day time,
 repeat_type text not null check(repeat_type in ('daily','weekly','weekdays')),
 weekdays smallint[] not null default '{}' check(weekdays <@ array[1,2,3,4,5,6,7]::smallint[]),
 starts_on date not null,ends_on date check(ends_on>=starts_on),is_active boolean not null default true,
 comment text not null default '' check(length(comment)<=5000),
 timezone text not null default 'Europe/Moscow',
 created_by uuid not null references auth.users(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 check(repeat_type<>'weekdays' or cardinality(weekdays)>0)
);
create table public.training_schedule_commands(
 schedule_id uuid not null references public.training_schedules(id) on delete cascade,
 command_id uuid not null references public.commands(id) on delete restrict,
 primary key(schedule_id,command_id)
);
create index schedule_pet on public.training_schedules(pet_id);
create index schedule_creator on public.training_schedules(created_by);
create index schedule_command on public.training_schedule_commands(command_id);
alter table public.training_schedules enable row level security;
alter table public.training_schedule_commands enable row level security;
revoke all on public.training_schedules,public.training_schedule_commands from public,anon,authenticated;
grant select on public.training_schedules,public.training_schedule_commands to authenticated;
create policy schedule_member_read on public.training_schedules for select to authenticated using(pet_private.member_role(pet_id) is not null);
create policy schedule_commands_member_read on public.training_schedule_commands for select to authenticated using(exists(select 1 from public.training_schedules s where s.id=schedule_id and pet_private.member_role(s.pet_id) is not null));
alter table public.training_sessions
 add column status text not null default 'completed' check(status in ('planned','completed','cancelled')),
 add column occurrence_at timestamptz,add column scheduled_at timestamptz,add column completed_at timestamptz,
 add column name text not null default '' check(length(name)<=120),add column time_of_day time,
 add column schedule_id uuid references public.training_schedules(id) on delete restrict,
 add column created_by uuid references auth.users(id);
alter table public.training_sessions disable trigger training_touch;
update public.training_sessions set completed_at=(date+time '12:00') at time zone 'Europe/Moscow',created_by=user_id;
alter table public.training_sessions enable trigger training_touch;
alter table public.training_sessions alter column created_by set not null;
alter table public.training_sessions add check(status<>'planned' or scheduled_at is not null),add check(status<>'completed' or completed_at is not null),
add unique(schedule_id,scheduled_at),add unique(schedule_id,occurrence_at);
create index training_status on public.training_sessions(pet_id,status);
create index training_scheduled on public.training_sessions(scheduled_at);
create index training_completed on public.training_sessions(completed_at desc);
create index training_schedule on public.training_sessions(schedule_id);
create index training_creator on public.training_sessions(created_by);
create index member_user_pet_status on public.pet_members(user_id,pet_id,status);
create or replace function public.training_touch() returns trigger language plpgsql security invoker set search_path='' as $x$
begin new.created_at=old.created_at;
 if to_jsonb(new)-'updated_at' is distinct from to_jsonb(old)-'updated_at' then new.updated_at=now();end if;
 return new;end $x$;
create function pet_private.command_touch() returns trigger language plpgsql set search_path='' as $x$
begin
 if tg_op='UPDATE' then new.created_at=old.created_at;new.updated_at=case when (new.name,new.archived) is distinct from (old.name,old.archived) then now() else old.updated_at end;end if;
 new.archived_at=case when new.archived then coalesce(new.archived_at,now()) else null end;return new;end $x$;
create trigger command_touch before insert or update on public.commands for each row execute function pet_private.command_touch();
create trigger schedule_touch before update on public.training_schedules for each row execute function public.training_touch();
create trigger result_touch before update on public.training_session_commands for each row execute function public.training_touch();
create or replace function public.result_touch_training() returns trigger language plpgsql security invoker set search_path='' as $x$
begin update public.training_sessions set updated_at=now() where id=case when tg_op='DELETE' then old.training_session_id else new.training_session_id end;return null;end $x$;
create trigger result_touch_training after insert or update or delete on public.training_session_commands for each row execute function public.result_touch_training();
create or replace function public.training_require_result() returns trigger language plpgsql security invoker set search_path='' as $x$
declare sid uuid;begin
 if tg_table_name='training_sessions' then sid=new.id; elsif tg_op='DELETE' then sid=old.training_session_id; else sid=new.training_session_id; end if;
 if exists(select 1 from public.training_sessions s where s.id=sid and status='completed')
 and (not exists(select 1 from public.training_session_commands where training_session_id=sid) or exists(select 1 from public.training_session_commands where training_session_id=sid and performance_score is null))
 then raise exception 'Оцените команды проведённой тренировки' using errcode='23514';end if;
 return null;end $x$;
create constraint trigger training_nonempty after insert or update on public.training_sessions deferrable initially deferred for each row execute function public.training_require_result();
create constraint trigger result_nonempty after insert or delete or update on public.training_session_commands deferrable initially deferred for each row execute function public.training_require_result();
create function pet_private.result_pet_check() returns trigger language plpgsql set search_path='' as $x$
begin
 if (select pet_id from public.commands where id=new.command_id) is distinct from (select pet_id from public.training_sessions where id=new.training_session_id)
 then raise exception 'Команда другого питомца' using errcode='23514';end if;return new;end $x$;
create trigger result_pet_check before insert or update on public.training_session_commands for each row execute function pet_private.result_pet_check();

create function pet_private.expand_training() returns void language plpgsql security definer set search_path='' as $x$
declare sc public.training_schedules;d date;sid uuid;changed boolean;owner_id uuid;
begin
 if auth.uid() is null then raise exception 'Требуется вход' using errcode='42501';end if;
 perform 1 from public.pets p where pet_private.member_role(p.id) is not null order by p.id for update;
 for sc in select * from public.training_schedules where is_active and pet_private.member_role(pet_id) is not null loop
 changed=false;
 select owner_user_id into owner_id from public.pets where id=sc.pet_id;
 for d in select generate_series(greatest(sc.starts_on,current_date),least(coalesce(sc.ends_on,current_date+90),greatest(sc.starts_on,current_date)+90),interval '1 day')::date loop
 if sc.repeat_type='daily' or (sc.repeat_type='weekly' and extract(isodow from d)=extract(isodow from sc.starts_on)) or (sc.repeat_type='weekdays' and extract(isodow from d)::smallint=any(sc.weekdays)) then
 sid=null;
 insert into public.training_sessions(id,pet_id,user_id,date,status,scheduled_at,occurrence_at,name,time_of_day,schedule_id,created_by,comment)
 values(gen_random_uuid(),sc.pet_id,owner_id,d,'planned',(d+coalesce(sc.time_of_day,time '12:00')) at time zone sc.timezone,(d+coalesce(sc.time_of_day,time '12:00')) at time zone sc.timezone,sc.name,sc.time_of_day,sc.id,sc.created_by,sc.comment)
 on conflict do nothing returning id into sid;
 if sid is not null then
 changed=true;
 insert into public.training_session_commands(training_session_id,command_id)
 select sid,c.command_id from public.training_schedule_commands c where c.schedule_id=sc.id;
 end if;
 end if;end loop;
 if changed then update public.pets set revision=revision+1,updated_at=now() where id=sc.pet_id;end if;
 end loop;
end $x$;
revoke all on function pet_private.expand_training(),pet_private.command_touch(),pet_private.result_pet_check() from public,anon,authenticated;
create or replace function pet_private.load_state() returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); result jsonb; chosen text;
begin
 if uid is null then raise exception 'Требуется вход' using errcode='42501'; end if;
 perform pet_private.expand_training();
 select coalesce(jsonb_agg(p.data||jsonb_build_object('id',p.id,'shareCode',p.share_code,'role',m.role,'revision',p.revision,
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
end $$;
create or replace function pet_private.save_state(changes jsonb,removed jsonb,selected_pet text) returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); owner_id uuid; item jsonb; p jsonb; c jsonb; s jsonb; r jsonb; pid uuid; sid uuid; existing public.pets; n integer; sc jsonb; changed boolean;cid uuid;
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
   update public.pets set data=p-'trainingVersion'-'trainingSchedules'-'trainingDiary'-'commands'-'workouts'-'shareCode'-'role'-'revision'-'pendingRequests',revision=revision+1,updated_at=now() where id=pid;
  else
   if item->>'revision' is not null then raise exception 'Питомец недоступен' using errcode='42501'; end if;
   owner_id=uid;
   loop begin
    insert into public.pets(id,owner_user_id,data) values(pid,uid,p-'trainingVersion'-'trainingSchedules'-'trainingDiary'-'commands'-'workouts'-'shareCode'-'role'-'revision'-'pendingRequests'); exit;
   exception when unique_violation then
    if exists(select 1 from public.pets where id=pid) then raise exception 'Такой питомец уже существует' using errcode='PT409'; end if;
   end; end loop;
   insert into public.pet_members(pet_id,user_id,role) values(pid,uid,'owner');
  end if;
  -- Remove results before replacing a training; the deferred constraint checks the final state.
  delete from public.training_session_commands r0 where r0.training_session_id in (select id from public.training_sessions where pet_id=pid) and not exists (
    select 1 from jsonb_array_elements(coalesce(p->'workouts','[]')) w, jsonb_array_elements(w->'results') x
    where w->>'id'=r0.training_session_id::text and x->>'command_id'=r0.command_id::text
  );
  delete from public.training_sessions where user_id=owner_id and pet_id=pid and id::text not in(select x->>'id' from jsonb_array_elements(coalesce(p->'workouts','[]')) x);
  update public.commands set archived=true where user_id=owner_id and pet_id=pid and id::text not in(select x->>'id' from jsonb_array_elements(p->'commands') x);
  for c in select * from jsonb_array_elements(p->'commands') loop
   insert into public.commands(id,pet_id,user_id,name,archived) values((c->>'id')::uuid,pid,owner_id,btrim(c->>'name'),coalesce((c->>'archived')::boolean,false))
    on conflict(id) do update set name=excluded.name,archived=case when c ? 'archived' then excluded.archived else public.commands.archived end
     where public.commands.pet_id=excluded.pet_id;
   if not found then raise exception 'Команда принадлежит другому питомцу' using errcode='23514'; end if;
  end loop;
  for s in select * from jsonb_array_elements(coalesce(p->'workouts','[]')) loop
   if jsonb_typeof(s->'results') is distinct from 'array' or (coalesce(s->>'status','completed')='completed' and jsonb_array_length(s->'results')<1) then raise exception 'Выберите хотя бы одну команду' using errcode='23514'; end if;
   if (select count(*)<>count(distinct x->>'command_id') from jsonb_array_elements(s->'results') x) then raise exception 'Команда повторяется в тренировке' using errcode='23514'; end if;
   sid=(s->>'id')::uuid;
   if s->>'schedule_id' is not null and not exists(select 1 from public.training_schedules where id=(s->>'schedule_id')::uuid and pet_id=pid) then raise exception 'График другого питомца' using errcode='23514';end if;
   insert into public.training_sessions(id,pet_id,user_id,date,duration_minutes,comment,created_at,status,scheduled_at,completed_at,name,time_of_day,schedule_id,created_by)
    values(sid,pid,owner_id,(s->>'date')::date,(s->>'duration_minutes')::integer,coalesce(s->>'comment',''),coalesce((s->>'created_at')::timestamptz,now()),coalesce(s->>'status','completed'),(s->>'scheduled_at')::timestamptz,case when coalesce(s->>'status','completed')='completed' then coalesce((s->>'completed_at')::timestamptz,((s->>'date')::date+time '12:00') at time zone 'Europe/Moscow') else null end,coalesce(s->>'name',''),nullif(s->>'time','')::time,(s->>'schedule_id')::uuid,uid)
    on conflict(id) do update set date=excluded.date,duration_minutes=excluded.duration_minutes,comment=excluded.comment,status=excluded.status,scheduled_at=excluded.scheduled_at,completed_at=excluded.completed_at,name=excluded.name,time_of_day=excluded.time_of_day
     where public.training_sessions.pet_id=excluded.pet_id;
   if not found then raise exception 'Тренировка принадлежит другому питомцу' using errcode='23514'; end if;
   for r in select * from jsonb_array_elements(s->'results') loop
    insert into public.training_session_commands(training_session_id,command_id,performance_score,mode,comment)
     values(sid,(r->>'command_id')::uuid,(r->>'performance_score')::integer,coalesce(r->>'mode','repeat'),coalesce(r->>'comment',''))
     on conflict(training_session_id,command_id) do update set performance_score=excluded.performance_score,mode=excluded.mode,comment=excluded.comment
      where (public.training_session_commands.performance_score,public.training_session_commands.mode,public.training_session_commands.comment) is distinct from (excluded.performance_score,excluded.mode,excluded.comment);
   end loop;
  end loop;

  if p ? 'trainingSchedules' then
   if jsonb_typeof(p->'trainingSchedules')<>'array' then raise exception 'Некорректный график' using errcode='23514';end if;
   for sc in select * from jsonb_array_elements(p->'trainingSchedules') loop
    if exists(select 1 from public.training_schedules where id=(sc->>'id')::uuid and pet_id<>pid) then raise exception 'График другого питомца' using errcode='42501';end if;
    changed=not exists(select 1 from public.training_schedules t where t.id=(sc->>'id')::uuid and
      (t.name,t.time_of_day,t.repeat_type,to_jsonb(t.weekdays),t.starts_on,t.ends_on,t.is_active,t.comment) is not distinct from
      (coalesce(sc->>'name',''),nullif(sc->>'time_of_day','')::time,sc->>'repeat_type',sc->'weekdays',(sc->>'starts_on')::date,(sc->>'ends_on')::date,(sc->>'is_active')::boolean,coalesce(sc->>'comment',''))
      and (select coalesce(jsonb_agg(c.command_id::text order by c.command_id::text),'[]') from public.training_schedule_commands c where c.schedule_id=t.id)=(select coalesce(jsonb_agg(x order by x),'[]') from jsonb_array_elements_text(sc->'command_ids') x));
    insert into public.training_schedules(id,pet_id,name,time_of_day,repeat_type,weekdays,starts_on,ends_on,is_active,comment,created_by)
    values((sc->>'id')::uuid,pid,coalesce(sc->>'name',''),nullif(sc->>'time_of_day','')::time,sc->>'repeat_type',array(select x::smallint from jsonb_array_elements_text(sc->'weekdays') x),(sc->>'starts_on')::date,(sc->>'ends_on')::date,(sc->>'is_active')::boolean,coalesce(sc->>'comment',''),uid)
    on conflict(id) do update set name=excluded.name,time_of_day=excluded.time_of_day,repeat_type=excluded.repeat_type,weekdays=excluded.weekdays,starts_on=excluded.starts_on,ends_on=excluded.ends_on,is_active=excluded.is_active,comment=excluded.comment;
    if changed then
     delete from public.training_sessions where schedule_id=(sc->>'id')::uuid and status='planned' and date>=current_date;
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
end $$;
do $x$ declare b record;begin select * into b from training_before;
 if b.pets<>(select count(*) from public.pets) or b.commands<>(select count(*) from public.commands)
 or b.sessions<>(select count(*) from public.training_sessions) or b.results<>(select count(*) from public.training_session_commands)
 or b.session_hash is distinct from (select md5(string_agg(jsonb_build_array(id,pet_id,date,duration_minutes,comment,created_at)::text,'' order by id)) from public.training_sessions)
 or b.result_hash is distinct from (select md5(string_agg(jsonb_build_array(id,training_session_id,command_id,performance_score,comment,mode,created_at)::text,'' order by id)) from public.training_session_commands)
 then raise exception 'Проверка сохранности истории не пройдена';end if;
end $x$;
insert into pet_private.data_migrations(name) values('training_planning_v2');

$training$;end $migration$;
