
-- Legacy user_state is retained for an owner-only, one-time migration.
-- New data is stored in owned relational tables; no service-role functions.
create table public.account_state (
 user_id uuid primary key references auth.users(id) on delete cascade,
 selected_pet text not null, revision bigint not null default 0
);
create table public.pets (
 id text not null, user_id uuid not null references auth.users(id) on delete cascade,
 data jsonb not null check(jsonb_typeof(data)='object'),
 created_at timestamptz not null default now(),
 primary key(id,user_id)
);
create index pets_owner on public.pets(user_id);
create table public.commands (
 id text not null, pet_id text not null, user_id uuid not null,
 name text not null check(name=btrim(name) and length(name) between 1 and 120),
 created_at timestamptz not null default now(),
 primary key(id,user_id), unique(id,pet_id,user_id),
 foreign key(pet_id,user_id) references public.pets(id,user_id) on delete cascade
);
create unique index command_unique_name on public.commands(user_id,pet_id,lower(name));
create table public.training_sessions (
 id uuid not null, pet_id text not null, user_id uuid not null,
 date date not null, duration_minutes integer check(duration_minutes between 1 and 600),
 comment text not null default '' check(length(comment)<=5000),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 primary key(id,user_id), unique(id,pet_id,user_id),
 foreign key(pet_id,user_id) references public.pets(id,user_id) on delete cascade
);
create index training_owner_pet_date on public.training_sessions(user_id,pet_id,date desc);
create table public.training_command_results (
 id uuid primary key default gen_random_uuid(),
 training_session_id uuid not null, command_id text not null,
 pet_id text not null, user_id uuid not null,
 performance_score integer not null check(performance_score between 1 and 5),
 mode text not null default 'repeat' check(mode in ('new','learning','repeat')),
 comment text not null default '' check(length(comment)<=5000),
 created_at timestamptz not null default now(),
 unique(training_session_id,command_id,user_id),
 foreign key(training_session_id,pet_id,user_id) references public.training_sessions(id,pet_id,user_id) on delete cascade,
 foreign key(command_id,pet_id,user_id) references public.commands(id,pet_id,user_id) on delete cascade
);
create index result_owner on public.training_command_results(user_id);
create index result_command on public.training_command_results(command_id,pet_id,user_id);
create index result_session on public.training_command_results(training_session_id,pet_id,user_id);

do $$
declare t text;
begin
 foreach t in array array['account_state','pets','commands','training_sessions','training_command_results'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from anon',t);
  execute format('grant select,insert,update,delete on public.%I to authenticated',t);
  execute format('create policy %I on public.%I for select to authenticated using ((select auth.uid())=user_id)',t||'_select_own',t);
  execute format('create policy %I on public.%I for insert to authenticated with check ((select auth.uid())=user_id)',t||'_insert_own',t);
  execute format('create policy %I on public.%I for update to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id)',t||'_update_own',t);
  execute format('create policy %I on public.%I for delete to authenticated using ((select auth.uid())=user_id)',t||'_delete_own',t);
 end loop;
end $$;

create function public.training_touch() returns trigger language plpgsql security invoker set search_path='' as $$
begin new.updated_at=now(); new.created_at=old.created_at; return new; end $$;
create trigger training_touch before update on public.training_sessions for each row execute function public.training_touch();

create function public.training_require_result() returns trigger language plpgsql security invoker set search_path='' as $$
declare sid uuid; uid uuid;
begin
 if TG_TABLE_NAME='training_sessions' then sid=new.id; uid=new.user_id;
 else sid=old.training_session_id; uid=old.user_id; end if;
 if exists(select 1 from public.training_sessions where id=sid and user_id=uid)
 and not exists(select 1 from public.training_command_results where training_session_id=sid and user_id=uid) then
  raise exception 'Выберите хотя бы одну команду' using errcode='23514';
 end if;
 return null;
end $$;
create constraint trigger training_nonempty after insert or update on public.training_sessions
 deferrable initially deferred for each row execute function public.training_require_result();
create constraint trigger result_nonempty after delete or update on public.training_command_results
 deferrable initially deferred for each row execute function public.training_require_result();

create function public.load_app_state() returns jsonb language plpgsql security invoker set search_path='' as $$
declare uid uuid:=auth.uid(); meta public.account_state; result jsonb; legacy jsonb;
begin
 if uid is null then raise exception 'Требуется вход' using errcode='42501'; end if;
 select * into meta from public.account_state where user_id=uid;
 if not found then
  select state into legacy from public.user_state where user_id=uid;
  return jsonb_build_object('state',legacy,'revision',0,'legacy',legacy is not null);
 end if;
 select jsonb_build_object('version',1,'selectedPet',meta.selected_pet,'pets',coalesce(jsonb_agg(
   p.data || jsonb_build_object('id',p.id,
    'commands',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'name',c.name) order by c.created_at,c.id) from public.commands c where c.user_id=uid and c.pet_id=p.id),'[]'::jsonb),
    'workouts',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'date',s.date,'duration_minutes',s.duration_minutes,'comment',s.comment,'created_at',s.created_at,'updated_at',s.updated_at,
      'results',coalesce((select jsonb_agg(jsonb_build_object('command_id',r.command_id,'performance_score',r.performance_score,'mode',r.mode,'comment',r.comment) order by r.created_at,r.id)
        from public.training_command_results r where r.user_id=uid and r.training_session_id=s.id),'[]'::jsonb)) order by s.date desc,s.created_at desc)
      from public.training_sessions s where s.user_id=uid and s.pet_id=p.id),'[]'::jsonb)
   ) order by p.created_at,p.id),'[]'::jsonb)) into result from public.pets p where p.user_id=uid;
 return jsonb_build_object('state',result,'revision',meta.revision,'legacy',false);
end $$;

create function public.save_app_state(payload jsonb,expected_revision bigint) returns bigint language plpgsql security invoker set search_path='' as $$
declare uid uuid:=auth.uid(); current_revision bigint; p jsonb; c jsonb; s jsonb; r jsonb; pid text; sid uuid; result_revision bigint;
begin
 if uid is null then raise exception 'Требуется вход' using errcode='42501'; end if;
 if payload->>'version' is distinct from '1' or jsonb_typeof(payload->'pets') is distinct from 'array'
 or jsonb_array_length(payload->'pets')<1 then raise exception 'Некорректные данные питомцев' using errcode='23514'; end if;
 if not exists(select 1 from jsonb_array_elements(payload->'pets') x where x->>'id'=payload->>'selectedPet') then raise exception 'Выберите питомца' using errcode='23514'; end if;
 if (select count(*)<>count(distinct x->>'id') from jsonb_array_elements(payload->'pets') x) then raise exception 'Повторяющиеся питомцы' using errcode='23514'; end if;
 insert into public.account_state(user_id,selected_pet) values(uid,payload->>'selectedPet') on conflict do nothing;
 select revision into current_revision from public.account_state where user_id=uid for update;
 if current_revision is distinct from expected_revision then raise exception 'Данные изменились на другом устройстве. Обновите страницу перед сохранением.' using errcode='40001'; end if;
 for p in select * from jsonb_array_elements(payload->'pets') loop
  pid=p->>'id';
  if pid is null or length(btrim(p->>'name')) not between 1 and 120 then raise exception 'Укажите питомца' using errcode='23514'; end if;
  insert into public.pets(id,user_id,data) values(pid,uid,p-'commands'-'workouts')
   on conflict(id,user_id) do update set data=excluded.data;
  -- Remove results before replacing a training; the deferred constraint checks the final state.
  delete from public.training_command_results where user_id=uid and pet_id=pid;
  delete from public.training_sessions where user_id=uid and pet_id=pid and id::text not in(select x->>'id' from jsonb_array_elements(coalesce(p->'workouts','[]')) x);
  delete from public.commands where user_id=uid and pet_id=pid and id not in(select x->>'id' from jsonb_array_elements(p->'commands') x);
  for c in select * from jsonb_array_elements(p->'commands') loop
   insert into public.commands(id,pet_id,user_id,name) values(c->>'id',pid,uid,btrim(c->>'name'))
    on conflict(id,user_id) do update set name=excluded.name
     where public.commands.pet_id=excluded.pet_id;
   if not found then raise exception 'Команда принадлежит другому питомцу' using errcode='23514'; end if;
  end loop;
  for s in select * from jsonb_array_elements(coalesce(p->'workouts','[]')) loop
   if jsonb_typeof(s->'results') is distinct from 'array' or jsonb_array_length(s->'results')<1 then raise exception 'Выберите хотя бы одну команду' using errcode='23514'; end if;
   sid=(s->>'id')::uuid;
   insert into public.training_sessions(id,pet_id,user_id,date,duration_minutes,comment,created_at)
    values(sid,pid,uid,(s->>'date')::date,(s->>'duration_minutes')::integer,coalesce(s->>'comment',''),coalesce((s->>'created_at')::timestamptz,now()))
    on conflict(id,user_id) do update set date=excluded.date,duration_minutes=excluded.duration_minutes,comment=excluded.comment
     where public.training_sessions.pet_id=excluded.pet_id;
   if not found then raise exception 'Тренировка принадлежит другому питомцу' using errcode='23514'; end if;
   for r in select * from jsonb_array_elements(s->'results') loop
    insert into public.training_command_results(training_session_id,command_id,pet_id,user_id,performance_score,mode,comment)
     values(sid,r->>'command_id',pid,uid,(r->>'performance_score')::integer,coalesce(r->>'mode','repeat'),coalesce(r->>'comment',''));
   end loop;
  end loop;
 end loop;
 delete from public.pets where user_id=uid and id not in(select x->>'id' from jsonb_array_elements(payload->'pets') x);
 update public.account_state set selected_pet=payload->>'selectedPet',revision=revision+1 where user_id=uid returning revision into result_revision;
 return result_revision;
end $$;
revoke all on function public.load_app_state(),public.save_app_state(jsonb,bigint),public.training_touch(),public.training_require_result() from public,anon;
grant execute on function public.load_app_state(),public.save_app_state(jsonb,bigint) to authenticated;
-- Disable the obsolete write endpoint (old clients must reload); retain owned legacy data.
revoke insert,update,delete on public.user_state from authenticated,anon;
