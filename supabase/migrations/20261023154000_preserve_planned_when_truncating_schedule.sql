-- Preserve existing earlier planned sessions when truncating a recurring schedule.
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
end $function$
;
