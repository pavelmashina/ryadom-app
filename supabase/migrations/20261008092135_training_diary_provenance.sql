-- Immutable source history; membership protection is the same as the pet.
create table public.training_diary(
 pet_id uuid not null references public.pets(id) on delete cascade,
 source_key text not null,
 source_hash text not null check(source_hash ~ '^[0-9a-f]{64}$'),
 date date not null,
 status text not null check(status in ('conducted','skipped','linked')),
 original_text text not null,
 -- Retain provenance even if an imported session is later removed.
 session_id uuid,
 details jsonb not null default '{}'::jsonb check(jsonb_typeof(details)='object'),
 created_at timestamptz not null default now(),
 primary key(pet_id,source_key),
 check((status='skipped' and session_id is null) or (status<>'skipped' and session_id is not null))
);
alter table public.training_diary enable row level security;
revoke all on public.training_diary from public,anon,authenticated;
grant select on public.training_diary to authenticated;
create policy diary_member_read on public.training_diary for select to authenticated
 using(pet_private.member_role(pet_id) is not null);
create or replace function pet_private.load_state() returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); result jsonb; chosen text;
begin
 if uid is null then raise exception 'Требуется вход' using errcode='42501'; end if;
 select coalesce(jsonb_agg(p.data||jsonb_build_object('id',p.id,'shareCode',p.share_code,'role',m.role,'revision',p.revision,
 'trainingDiary',coalesce((select jsonb_agg(jsonb_build_object('source_key',d.source_key,'date',d.date,'status',d.status,'original_text',d.original_text,'session_id',d.session_id,'details',d.details) order by d.date desc,d.source_key) from public.training_diary d where d.pet_id=p.id),'[]'::jsonb),
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
create or replace function pet_private.save_state(changes jsonb,removed jsonb,selected_pet text) returns jsonb language plpgsql security definer set search_path='' as $$
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
   update public.pets set data=p-'trainingDiary'-'commands'-'workouts'-'shareCode'-'role'-'revision'-'pendingRequests',revision=revision+1,updated_at=now() where id=pid;
  else
   if item->>'revision' is not null then raise exception 'Питомец недоступен' using errcode='42501'; end if;
   owner_id=uid;
   loop begin
    insert into public.pets(id,owner_user_id,data) values(pid,uid,p-'trainingDiary'-'commands'-'workouts'-'shareCode'-'role'-'revision'-'pendingRequests'); exit;
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