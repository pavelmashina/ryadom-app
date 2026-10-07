-- Upgrade the existing pet rows in place; no copies of pets or child records.
create schema if not exists pet_private;
revoke all on schema pet_private from public, anon;
grant usage on schema pet_private to authenticated;
do $$ declare r record; begin
 for r in select conname,conrelid::regclass as tbl from pg_constraint
 where contype='f' and conrelid in ('public.commands'::regclass,'public.training_sessions'::regclass,'public.training_command_results'::regclass)
 loop execute format('alter table %s drop constraint %I',r.tbl,r.conname); end loop;
 for r in select tablename,policyname from pg_policies where schemaname='public'
 and tablename in ('pets','commands','training_sessions','training_command_results')
 loop execute format('drop policy %I on public.%I',r.policyname,r.tablename); end loop;
end $$;
alter table public.pets alter column id type uuid using id::uuid;
alter table public.pets rename column user_id to owner_user_id;
alter table public.pets add constraint pets_id_unique unique(id);
alter table public.commands alter column pet_id type uuid using pet_id::uuid;
alter table public.training_sessions alter column pet_id type uuid using pet_id::uuid;
alter table public.training_command_results alter column pet_id type uuid using pet_id::uuid;
alter table public.commands add foreign key(pet_id,user_id) references public.pets(id,owner_user_id) on delete cascade;
alter table public.training_sessions add foreign key(pet_id,user_id) references public.pets(id,owner_user_id) on delete cascade;
alter table public.training_command_results add foreign key(command_id,pet_id,user_id) references public.commands(id,pet_id,user_id) on delete cascade;
alter table public.training_command_results add foreign key(training_session_id,pet_id,user_id) references public.training_sessions(id,pet_id,user_id) on delete cascade;

create function pet_private.new_code() returns text language sql volatile security invoker set search_path='' as $$
 select 'RYD-'||upper(translate(substr(replace(gen_random_uuid()::text,'-',''),1,10),'0123456789abcdef','23456789ABCDEFGH'))
$$;
alter table public.pets
 add column share_code text not null default pet_private.new_code() unique,
 add column revision bigint not null default 1,
 add column updated_at timestamptz not null default now(),
 add column deleted_at timestamptz,
 add column name text generated always as (data->>'name') stored,
 add column breed text generated always as (data->>'breed') stored,
 add column birthday text generated always as (data->>'birthday') stored,
 add column sex text generated always as (data->>'sex') stored,
 add column chip text generated always as (data->>'chip') stored;
create table public.pet_members (
 id uuid primary key default gen_random_uuid(), pet_id uuid not null references public.pets(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 role text not null check(role in ('owner','editor')),
 status text not null default 'active' check(status in ('active','revoked')),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(pet_id,user_id)
);
create unique index pet_one_owner on public.pet_members(pet_id) where role='owner';
create index pet_members_user on public.pet_members(user_id,status,pet_id);
insert into public.pet_members(pet_id,user_id,role) select id,owner_user_id,'owner' from public.pets;
create table public.pet_access_requests (
 id uuid primary key default gen_random_uuid(), pet_id uuid not null references public.pets(id) on delete cascade,
 requester_user_id uuid not null references auth.users(id) on delete cascade,
 status text not null default 'pending' check(status in ('pending','approved','rejected','cancelled')),
 created_at timestamptz not null default now(), resolved_at timestamptz,
 resolved_by uuid references auth.users(id) on delete set null
);
create unique index one_pending_request on public.pet_access_requests(pet_id,requester_user_id) where status='pending';
create index requests_user on public.pet_access_requests(requester_user_id,created_at desc);
create index requests_pet on public.pet_access_requests(pet_id,status);
create index requests_resolver on public.pet_access_requests(resolved_by);
create table pet_private.rate_limits(user_id uuid primary key references auth.users(id) on delete cascade,window_at timestamptz not null,hits integer not null);
alter table pet_private.rate_limits enable row level security;
revoke all on pet_private.rate_limits from public,anon,authenticated;

create function pet_private.member_role(pid uuid) returns text language sql stable security definer set search_path='' as $$
 select m.role from public.pet_members m join public.pets p on p.id=m.pet_id
 where auth.uid() is not null and m.user_id=auth.uid() and m.pet_id=pid and m.status='active' and p.deleted_at is null
$$;
do $$ declare t text; begin
 foreach t in array array['pets','commands','training_sessions','training_command_results','pet_members','pet_access_requests'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant select on public.%I to authenticated',t);
 end loop;
end $$;
create policy pets_member_read on public.pets for select to authenticated using(pet_private.member_role(id) is not null);
create policy commands_member_read on public.commands for select to authenticated using(pet_private.member_role(pet_id) is not null);
create policy sessions_member_read on public.training_sessions for select to authenticated using(pet_private.member_role(pet_id) is not null);
create policy results_member_read on public.training_command_results for select to authenticated using(pet_private.member_role(pet_id) is not null);
create policy members_read on public.pet_members for select to authenticated using(user_id=(select auth.uid()) or pet_private.member_role(pet_id)='owner');
create policy requests_read on public.pet_access_requests for select to authenticated using(requester_user_id=(select auth.uid()) or pet_private.member_role(pet_id)='owner');
-- Old snapshots must never overwrite shared data or expose a revoked owner's cache.
revoke all on public.user_state from anon,authenticated;
create or replace function public.load_app_state() returns jsonb language plpgsql security invoker set search_path='' as $$ begin return pet_private.load_state(); end $$;
create or replace function public.save_app_state(payload jsonb,expected_revision bigint) returns bigint language plpgsql security invoker set search_path='' as $$ begin raise exception 'Обновите приложение для совместного доступа' using errcode='PT409'; end $$;

create function pet_private.state_tag() returns text language sql stable security definer set search_path='' as $$
 select md5(coalesce(jsonb_agg(jsonb_build_array(p.id,p.revision,p.share_code,m.role,
   case when m.role='owner' then (select count(*) from public.pet_access_requests r where r.pet_id=p.id and r.status='pending') else 0 end) order by p.id)::text,''))
 from public.pets p join public.pet_members m on m.pet_id=p.id
 where auth.uid() is not null and m.user_id=auth.uid() and m.status='active' and p.deleted_at is null
$$;
create function public.shared_state_tag() returns text language sql security invoker set search_path='' as $$ select pet_private.state_tag() $$;
create function pet_private.load_state() returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); result jsonb; chosen text;
begin
 if uid is null then raise exception 'Требуется вход' using errcode='42501'; end if;
 select coalesce(jsonb_agg(p.data||jsonb_build_object('id',p.id,'shareCode',p.share_code,'role',m.role,'revision',p.revision,
 'pendingRequests',case when m.role='owner' then (select count(*) from public.pet_access_requests q where q.pet_id=p.id and q.status='pending') else 0 end,
 'commands',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'name',c.name) order by c.created_at,c.id) from public.commands c where c.pet_id=p.id),'[]'::jsonb),
 'workouts',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'date',s.date,'duration_minutes',s.duration_minutes,'comment',s.comment,'created_at',s.created_at,'updated_at',s.updated_at,
 'results',coalesce((select jsonb_agg(jsonb_build_object('command_id',r.command_id,'performance_score',r.performance_score,'mode',r.mode,'comment',r.comment) order by r.created_at,r.id) from public.training_command_results r where r.pet_id=p.id and r.training_session_id=s.id),'[]'::jsonb)) order by s.date desc,s.created_at desc) from public.training_sessions s where s.pet_id=p.id),'[]'::jsonb)) order by p.created_at,p.id),'[]'::jsonb)
 into result from public.pets p join public.pet_members m on m.pet_id=p.id
 where m.user_id=uid and m.status='active' and p.deleted_at is null;
 select selected_pet into chosen from public.account_state where user_id=uid;
 if not exists(select 1 from jsonb_array_elements(result) x where x->>'id'=chosen) then chosen=result->0->>'id'; end if;
 return jsonb_build_object('state',jsonb_build_object('version',1,'selectedPet',coalesce(chosen,''),'pets',result),'revision',0,'tag',(select md5(coalesce(jsonb_agg(jsonb_build_array(x->'id',x->'revision',x->'shareCode',x->'role',x->'pendingRequests') order by x->>'id')::text,'')) from jsonb_array_elements(result) x));
end $$;

create function pet_private.access(action text,code text,target uuid,subject uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); p public.pets; q public.pet_access_requests; rid uuid; role_name text; n integer; result jsonb;
begin
 if uid is null then raise exception 'Требуется вход' using errcode='42501'; end if;
 if action in ('lookup','request') then
  insert into pet_private.rate_limits values(uid,clock_timestamp(),1)
  on conflict(user_id) do update set hits=case when pet_private.rate_limits.window_at < clock_timestamp()-interval '1 minute' then 1 else pet_private.rate_limits.hits+1 end,
  window_at=case when pet_private.rate_limits.window_at < clock_timestamp()-interval '1 minute' then clock_timestamp() else pet_private.rate_limits.window_at end returning hits into n;
  if n>20 then return jsonb_build_object('error','Слишком много попыток. Подождите минуту.'); end if;
  select * into p from public.pets where share_code=upper(btrim(code)) and deleted_at is null for update;
  if not found then return jsonb_build_object('error','Питомец с таким ID не найден.'); end if;
  role_name=pet_private.member_role(p.id);
  if role_name is not null then return jsonb_build_object('name',p.name,'status','active'); end if;
  if action='lookup' then
   return jsonb_build_object('name',p.name,'status',case when exists(select 1 from public.pet_access_requests where pet_id=p.id and requester_user_id=uid and status='pending') then 'pending' else 'available' end);
  end if;
  insert into public.pet_access_requests(pet_id,requester_user_id) values(p.id,uid) on conflict(pet_id,requester_user_id) where status='pending' do nothing;
  return jsonb_build_object('name',p.name,'status','pending');
 end if;
 if action='outgoing' then
  select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'name',lookup_pet.name,'status',r.status,'created_at',r.created_at) order by r.created_at desc),'[]'::jsonb) into result
  from public.pet_access_requests r join public.pets lookup_pet on lookup_pet.id=r.pet_id where r.requester_user_id=uid;
  return result;
 end if;
 if action in ('approve','reject','cancel') then
  select * into q from public.pet_access_requests where id=subject;
  if not found then raise exception 'Запрос не найден' using errcode='42501'; end if;
  target=q.pet_id;
 end if;
 select * into p from public.pets where id=target and deleted_at is null for update;
 if not found then raise exception 'Питомец недоступен' using errcode='42501'; end if;
 role_name=pet_private.member_role(p.id);
 if action='cancel' then
  if q.requester_user_id<>uid then raise exception 'Нет доступа' using errcode='42501'; end if;
  update public.pet_access_requests set status='cancelled',resolved_at=now(),resolved_by=uid where id=q.id and status='pending';
  return '{}'::jsonb;
 end if;
 if action='leave' and role_name='editor' then
  update public.pet_members set status='revoked',updated_at=now() where pet_id=p.id and user_id=uid;
  return '{}'::jsonb;
 end if;
 if role_name is distinct from 'owner' then raise exception 'Это действие доступно только владельцу' using errcode='42501'; end if;
 if action='manage' then
  return jsonb_build_object('members',coalesce((select jsonb_agg(jsonb_build_object('user_id',m.user_id,'email',u.email,'role',m.role) order by m.role desc,m.created_at) from public.pet_members m join auth.users u on u.id=m.user_id where m.pet_id=p.id and m.status='active'),'[]'::jsonb),
  'requests',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'email',u.email,'created_at',r.created_at) order by r.created_at) from public.pet_access_requests r join auth.users u on u.id=r.requester_user_id where r.pet_id=p.id and r.status='pending'),'[]'::jsonb));
 elsif action in ('approve','reject') then
  select * into q from public.pet_access_requests where id=subject for update;
  if q.status<>'pending' then raise exception 'Запрос уже обработан' using errcode='PT409'; end if;
  update public.pet_access_requests set status=case when action='approve' then 'approved' else 'rejected' end,resolved_at=now(),resolved_by=uid where id=q.id;
  if action='approve' then
   insert into public.pet_members(pet_id,user_id,role) values(p.id,q.requester_user_id,'editor')
   on conflict(pet_id,user_id) do update set status='active',updated_at=now() where public.pet_members.role='editor';
  end if;
 elsif action='revoke' then
  if exists(select 1 from public.pet_members where pet_id=p.id and user_id=subject and role='owner') then raise exception 'Нельзя отозвать владельца' using errcode='42501'; end if;
  update public.pet_members set status='revoked',updated_at=now() where pet_id=p.id and user_id=subject and role='editor';
 elsif action='rotate' then
  loop begin update public.pets set share_code=pet_private.new_code() where id=p.id; exit; exception when unique_violation then end; end loop;
 elsif action='delete' then
  update public.pets set deleted_at=now(),revision=revision+1 where id=p.id;
 else raise exception 'Неизвестное действие' using errcode='22023'; end if;
 return '{}'::jsonb;
end $$;

-- Public API consists only of invoker wrappers; privileged bodies stay unexposed.
create function public.load_shared_state() returns jsonb language sql security invoker set search_path='' as $$ select pet_private.load_state() $$;
create function public.pet_access(action text,code text default null,target uuid default null,subject uuid default null) returns jsonb language sql security invoker set search_path='' as $$ select pet_private.access(action,code,target,subject) $$;

create function pet_private.save_state(changes jsonb,removed jsonb,selected_pet text) returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); owner_id uuid; item jsonb; p jsonb; c jsonb; s jsonb; r jsonb; pid uuid; sid uuid; existing public.pets; n integer;
begin
 if uid is null then raise exception 'Требуется вход' using errcode='42501'; end if;
 if jsonb_typeof(changes) is distinct from 'array' or jsonb_typeof(removed) is distinct from 'array' or jsonb_array_length(changes)>100 then raise exception 'Некорректные данные' using errcode='23514'; end if;
 -- Serialize against all membership changes and other writers, in a stable order.
 perform 1 from public.pets where id in (select (x->'pet'->>'id')::uuid from jsonb_array_elements(changes) x union select (x->>'id')::uuid from jsonb_array_elements(removed) x) order by id for update;
 for item in select * from jsonb_array_elements(changes) loop
  p=item->'pet'; pid=(p->>'id')::uuid;
  if pid is null or length(btrim(p->>'name')) not between 1 and 120 or p->>'name' is null
   or jsonb_typeof(p->'commands') is distinct from 'array' or jsonb_typeof(p->'workouts') is distinct from 'array'
   then raise exception 'Некорректный питомец' using errcode='23514'; end if;
  if (select count(*)<>count(distinct x->>'id') from jsonb_array_elements(p->'commands') x) or (select count(*)<>count(distinct x->>'id') from jsonb_array_elements(p->'workouts') x) then raise exception 'Повторяющиеся команды или тренировки' using errcode='23514'; end if;
  select * into existing from public.pets where id=pid;
  if found then
   if pet_private.member_role(pid) is null then raise exception 'Доступ к питомцу отозван или отсутствует' using errcode='42501'; end if;
   if existing.revision is distinct from (item->>'revision')::bigint then raise exception 'Питомец изменён другим участником. Обновите данные перед сохранением.' using errcode='PT409'; end if;
   owner_id=existing.owner_user_id;
   update public.pets set data=p-'commands'-'workouts'-'shareCode'-'role'-'revision'-'pendingRequests',revision=revision+1,updated_at=now() where id=pid;
  else
   if item->>'revision' is not null then raise exception 'Питомец недоступен' using errcode='42501'; end if;
   owner_id=uid;
   loop begin
    insert into public.pets(id,owner_user_id,data) values(pid,uid,p-'commands'-'workouts'-'shareCode'-'role'-'revision'-'pendingRequests'); exit;
   exception when unique_violation then
    if exists(select 1 from public.pets where id=pid) then raise exception 'Такой питомец уже существует' using errcode='PT409'; end if;
   end; end loop;
   insert into public.pet_members(pet_id,user_id,role) values(pid,uid,'owner');
  end if;
  -- Remove results before replacing a training; the deferred constraint checks the final state.
  delete from public.training_command_results r0 where r0.user_id=owner_id and r0.pet_id=pid and not exists (
    select 1 from jsonb_array_elements(coalesce(p->'workouts','[]')) w, jsonb_array_elements(w->'results') x
    where w->>'id'=r0.training_session_id::text and x->>'command_id'=r0.command_id
  );
  delete from public.training_sessions where user_id=owner_id and pet_id=pid and id::text not in(select x->>'id' from jsonb_array_elements(coalesce(p->'workouts','[]')) x);
  delete from public.commands where user_id=owner_id and pet_id=pid and id not in(select x->>'id' from jsonb_array_elements(p->'commands') x);
  for c in select * from jsonb_array_elements(p->'commands') loop
   insert into public.commands(id,pet_id,user_id,name) values(c->>'id',pid,owner_id,btrim(c->>'name'))
    on conflict(id,user_id) do update set name=excluded.name
     where public.commands.pet_id=excluded.pet_id;
   if not found then raise exception 'Команда принадлежит другому питомцу' using errcode='23514'; end if;
  end loop;
  for s in select * from jsonb_array_elements(coalesce(p->'workouts','[]')) loop
   if jsonb_typeof(s->'results') is distinct from 'array' or jsonb_array_length(s->'results')<1 then raise exception 'Выберите хотя бы одну команду' using errcode='23514'; end if;
   if (select count(*)<>count(distinct x->>'command_id') from jsonb_array_elements(s->'results') x) then raise exception 'Команда повторяется в тренировке' using errcode='23514'; end if;
   sid=(s->>'id')::uuid;
   insert into public.training_sessions(id,pet_id,user_id,date,duration_minutes,comment,created_at)
    values(sid,pid,owner_id,(s->>'date')::date,(s->>'duration_minutes')::integer,coalesce(s->>'comment',''),coalesce((s->>'created_at')::timestamptz,now()))
    on conflict(id,user_id) do update set date=excluded.date,duration_minutes=excluded.duration_minutes,comment=excluded.comment
     where public.training_sessions.pet_id=excluded.pet_id;
   if not found then raise exception 'Тренировка принадлежит другому питомцу' using errcode='23514'; end if;
   for r in select * from jsonb_array_elements(s->'results') loop
    insert into public.training_command_results(training_session_id,command_id,pet_id,user_id,performance_score,mode,comment)
     values(sid,r->>'command_id',pid,owner_id,(r->>'performance_score')::integer,coalesce(r->>'mode','repeat'),coalesce(r->>'comment',''))
     on conflict(training_session_id,command_id,user_id) do update set performance_score=excluded.performance_score,mode=excluded.mode,comment=excluded.comment
      where (public.training_command_results.performance_score,public.training_command_results.mode,public.training_command_results.comment) is distinct from (excluded.performance_score,excluded.mode,excluded.comment);
   end loop;
  end loop;
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
create function public.save_shared_state(changes jsonb,removed jsonb,selected_pet text) returns jsonb language sql security invoker set search_path='' as $$ select pet_private.save_state(changes,removed,selected_pet) $$;
revoke all on all functions in schema pet_private from public,anon,authenticated;
grant execute on function pet_private.member_role(uuid),pet_private.state_tag(),pet_private.load_state(),pet_private.access(text,text,uuid,uuid),pet_private.save_state(jsonb,jsonb,text) to authenticated;
revoke all on function public.load_shared_state(),public.save_shared_state(jsonb,jsonb,text),public.pet_access(text,text,uuid,uuid) from public,anon;
grant execute on function public.load_shared_state(),public.save_shared_state(jsonb,jsonb,text),public.pet_access(text,text,uuid,uuid) to authenticated;
revoke all on function public.shared_state_tag() from public,anon;
grant execute on function public.shared_state_tag() to authenticated;
