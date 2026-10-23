-- Materialize arbitrary visible calendar months without imposing a recurrence end date.
CREATE OR REPLACE FUNCTION public.materialize_training_month(p_pet uuid, p_month date)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  uid uuid := auth.uid();
  first_day date;
  last_day date;
  sc public.training_schedules;
  d date;
  sid uuid;
  owner_id uuid;
  inserted_any boolean := false;
begin
  if uid is null or p_pet is null or p_month is null
    or pet_private.member_role(p_pet) is null
  then
    raise exception 'Нет доступа к графику питомца' using errcode='42501';
  end if;
  first_day := date_trunc('month',p_month)::date;
  last_day := (first_day + interval '1 month - 1 day')::date;
  -- Keep sessions unchanged for past months; never invent completed history.
  if last_day < current_date then return false; end if;
  select p.owner_user_id into owner_id
  from public.pets p where p.id=p_pet and p.deleted_at is null for update;
  if owner_id is null then raise exception 'Питомец недоступен' using errcode='42501';end if;
  for sc in select * from public.training_schedules
    where pet_id=p_pet and is_active
  loop
    for d in select generate_series(
      greatest(sc.starts_on, first_day, current_date),
      least(coalesce(sc.ends_on,last_day), last_day),
      interval '1 day'
    )::date loop
      if pet_private.recurrence_occurs(sc.id,d) then
        sid := null;
        insert into public.training_sessions
          (id,pet_id,user_id,date,status,scheduled_at,occurrence_at,
           name,time_of_day,schedule_id,created_by,comment)
        values(gen_random_uuid(),p_pet,owner_id,d,'planned',
          (d+coalesce(sc.time_of_day,time '12:00')) at time zone sc.timezone,
          (d+coalesce(sc.time_of_day,time '12:00')) at time zone sc.timezone,
          sc.name,sc.time_of_day,sc.id,sc.created_by,sc.comment)
        on conflict do nothing returning id into sid;
        if sid is not null then
          inserted_any := true;
          insert into public.training_session_commands(training_session_id,command_id)
            select sid,c.command_id from public.training_schedule_commands c
            where c.schedule_id=sc.id;
        end if;
      end if;
    end loop;
  end loop;
  if inserted_any then
    update public.pets set revision=revision+1,updated_at=now() where id=p_pet;
  end if;
  return inserted_any;
end $function$

revoke all on function public.materialize_training_month(uuid,date) from public,anon,authenticated;
grant execute on function public.materialize_training_month(uuid,date) to authenticated;
