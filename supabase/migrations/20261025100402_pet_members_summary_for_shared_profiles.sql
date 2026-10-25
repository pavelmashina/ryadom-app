-- The pet profile shows active users to all active members, without exposing
-- requests, inactive memberships, or the rest of auth.users.
create function pet_private.members_for_pet(pid uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or pet_private.member_role(pid) is null then
    raise exception 'Нет доступа к участникам питомца' using errcode = '42501';
  end if;

  return coalesce((
    select jsonb_agg(
      jsonb_build_object('user_id', m.user_id, 'email', u.email, 'role', m.role)
      order by case when m.role = 'owner' then 0 else 1 end, m.created_at
    )
    from public.pet_members m
    join public.pets p on p.id = m.pet_id
    join auth.users u on u.id = m.user_id
    where m.pet_id = pid
      and m.status = 'active'
      and p.deleted_at is null
  ), '[]'::jsonb);
end;
$$;

revoke all on function pet_private.members_for_pet(uuid) from public, anon, authenticated;
grant execute on function pet_private.members_for_pet(uuid) to authenticated;

create function public.pet_members_summary(target uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select pet_private.members_for_pet(target)
$$;

revoke all on function public.pet_members_summary(uuid) from public, anon;
grant execute on function public.pet_members_summary(uuid) to authenticated;
