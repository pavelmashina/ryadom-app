-- Avoid UPDATE triggers and WAL churn on unchanged historical sessions
-- when one session was inserted/edited/deleted.
do $patch$
declare body text; old_sql text; new_sql text;
begin
 body:=pg_get_functiondef('pet_private.save_state(jsonb,jsonb,text)'::regprocedure);
 old_sql:='where public.training_sessions.pet_id=excluded.pet_id;';
 new_sql:='where public.training_sessions.pet_id=excluded.pet_id and' || chr(10) ||
 '      (public.training_sessions.date,public.training_sessions.duration_minutes,public.training_sessions.comment,' ||
 'public.training_sessions.status,public.training_sessions.scheduled_at,public.training_sessions.completed_at,' ||
 'public.training_sessions.name,public.training_sessions.time_of_day) is distinct from' || chr(10) ||
 '      (excluded.date,excluded.duration_minutes,excluded.comment,excluded.status,' ||
 'excluded.scheduled_at,excluded.completed_at,excluded.name,excluded.time_of_day);';
 if position(old_sql in body)=0 then raise exception 'Missing session update predicate; refusing patch'; end if;
 body:=replace(body,old_sql,new_sql);
 old_sql:='if not found then raise exception ''Тренировка принадлежит другому питомцу'' using errcode=''23514''; end if;';
 new_sql:='if not found and not exists (' ||
 'select 1 from public.training_sessions where id=sid and pet_id=pid' ||
 ') then raise exception ''Тренировка принадлежит другому питомцу'' using errcode=''23514''; end if;';
 if position(old_sql in body)=0 then raise exception 'Missing session ownership guard; refusing patch'; end if;
 body:=replace(body,old_sql,new_sql);
 execute body;
end $patch$;
