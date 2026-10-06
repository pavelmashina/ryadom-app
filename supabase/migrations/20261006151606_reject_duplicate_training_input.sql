create or replace function public.save_app_state(payload jsonb,expected_revision bigint) returns bigint language plpgsql security invoker set search_path='' as $$
declare uid uuid:=auth.uid(); current_revision bigint; p jsonb; c jsonb; s jsonb; r jsonb; pid text; sid uuid; result_revision bigint;
begin
 if uid is null then raise exception 'Требуется вход' using errcode='42501'; end if;
 if payload->>'version' is distinct from '1' or jsonb_typeof(payload->'pets') is distinct from 'array'
 or jsonb_array_length(payload->'pets')<1 then raise exception 'Некорректные данные питомцев' using errcode='23514'; end if;
 if not exists(select 1 from jsonb_array_elements(payload->'pets') x where x->>'id'=payload->>'selectedPet') then raise exception 'Выберите питомца' using errcode='23514'; end if;
 if (select count(*)<>count(distinct x->>'id') from jsonb_array_elements(payload->'pets') x) then raise exception 'Повторяющиеся питомцы' using errcode='23514'; end if;
 insert into public.account_state(user_id,selected_pet) values(uid,payload->>'selectedPet') on conflict do nothing;
 select revision into current_revision from public.account_state where user_id=uid for update;
 if current_revision is distinct from expected_revision then raise exception 'Данные изменились на другом устройстве. Обновите страницу перед сохранением.' using errcode='PT409'; end if;
 for p in select * from jsonb_array_elements(payload->'pets') loop
  pid=p->>'id';
  if (select count(*)<>count(distinct x->>'id') from jsonb_array_elements(p->'commands') x) or (select count(*)<>count(distinct x->>'id') from jsonb_array_elements(coalesce(p->'workouts','[]')) x) then raise exception 'Повторяющиеся команды или тренировки' using errcode='23514'; end if;
  if pid is null or length(btrim(p->>'name')) not between 1 and 120 then raise exception 'Укажите питомца' using errcode='23514'; end if;
  insert into public.pets(id,user_id,data) values(pid,uid,p-'commands'-'workouts')
   on conflict(id,user_id) do update set data=excluded.data;
  -- Remove results before replacing a training; the deferred constraint checks the final state.
  delete from public.training_command_results r0 where r0.user_id=uid and r0.pet_id=pid and not exists (
    select 1 from jsonb_array_elements(coalesce(p->'workouts','[]')) w, jsonb_array_elements(w->'results') x
    where w->>'id'=r0.training_session_id::text and x->>'command_id'=r0.command_id
  );
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
   if (select count(*)<>count(distinct x->>'command_id') from jsonb_array_elements(s->'results') x) then raise exception 'Команда повторяется в тренировке' using errcode='23514'; end if;
   sid=(s->>'id')::uuid;
   insert into public.training_sessions(id,pet_id,user_id,date,duration_minutes,comment,created_at)
    values(sid,pid,uid,(s->>'date')::date,(s->>'duration_minutes')::integer,coalesce(s->>'comment',''),coalesce((s->>'created_at')::timestamptz,now()))
    on conflict(id,user_id) do update set date=excluded.date,duration_minutes=excluded.duration_minutes,comment=excluded.comment
     where public.training_sessions.pet_id=excluded.pet_id;
   if not found then raise exception 'Тренировка принадлежит другому питомцу' using errcode='23514'; end if;
   for r in select * from jsonb_array_elements(s->'results') loop
    insert into public.training_command_results(training_session_id,command_id,pet_id,user_id,performance_score,mode,comment)
     values(sid,r->>'command_id',pid,uid,(r->>'performance_score')::integer,coalesce(r->>'mode','repeat'),coalesce(r->>'comment',''))
     on conflict(training_session_id,command_id,user_id) do update set performance_score=excluded.performance_score,mode=excluded.mode,comment=excluded.comment
      where (public.training_command_results.performance_score,public.training_command_results.mode,public.training_command_results.comment) is distinct from (excluded.performance_score,excluded.mode,excluded.comment);
   end loop;
  end loop;
 end loop;
 delete from public.pets where user_id=uid and id not in(select x->>'id' from jsonb_array_elements(payload->'pets') x);
 update public.account_state set selected_pet=payload->>'selectedPet',revision=revision+1 where user_id=uid returning revision into result_revision;
 return result_revision;
end $$;
