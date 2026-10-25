-- Invitation dispatch is rate-limited server-side and never grants membership.
create table if not exists pet_private.pet_email_invitation_attempts (
  id bigint generated always as identity primary key,
  sender_user_id uuid not null,
  pet_id uuid not null,
  recipient_email text not null,
  created_at timestamptz not null default now()
);
create index if not exists pet_email_invitation_attempts_sender_time
  on pet_private.pet_email_invitation_attempts(sender_user_id, created_at desc);
alter table pet_private.pet_email_invitation_attempts enable row level security;
revoke all on pet_private.pet_email_invitation_attempts from public, anon, authenticated;

create function pet_private.prepare_pet_email_invitation(pid uuid, recipient text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  p public.pets;
  sender_email text;
  cleaned_email text := lower(btrim(recipient));
begin
  if uid is null then
    raise exception 'Войдите в аккаунт' using errcode = '42501';
  end if;
  if pet_private.member_role(pid) is distinct from 'owner' then
    raise exception 'Приглашать участников может только владелец питомца'
      using errcode = '42501';
  end if;
  if cleaned_email is null or length(cleaned_email) > 254
    or cleaned_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'Введите корректный адрес электронной почты'
      using errcode = '22023';
  end if;
  select * into p from public.pets where id = pid and deleted_at is null;
  if not found then raise exception 'Питомец не найден' using errcode = '42501'; end if;
  select email into sender_email from auth.users where id = uid;
  if sender_email is null then raise exception 'Отправитель не найден' using errcode = '42501'; end if;
  if lower(sender_email) = cleaned_email then
    raise exception 'Вы уже имеете доступ к этому питомцу' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.pet_members m
    join auth.users u on u.id = m.user_id
    where m.pet_id = pid and m.status = 'active' and lower(u.email) = cleaned_email
  ) then
    raise exception 'У этого пользователя уже есть доступ к питомцу' using errcode = '22023';
  end if;

  -- Serialize submissions by the same sender even across Edge Function instances.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(uid::text, 64071));
  if exists (
    select 1 from pet_private.pet_email_invitation_attempts a
    where a.sender_user_id = uid and a.pet_id = pid
      and a.recipient_email = cleaned_email
      and a.created_at > now() - interval '2 minutes'
  ) then
    raise exception 'Приглашение уже отправлялось недавно. Повторите через две минуты.'
      using errcode = '22023';
  end if;
  if (
    select count(*) from pet_private.pet_email_invitation_attempts a
    where a.sender_user_id = uid and a.created_at > now() - interval '1 day'
  ) >= 30 then
    raise exception 'Лимит приглашений на сегодня исчерпан' using errcode = '22023';
  end if;
  insert into pet_private.pet_email_invitation_attempts(sender_user_id, pet_id, recipient_email)
  values (uid, pid, cleaned_email);
  -- Share codes never grant access on their own: a separate owner-approved request is required.
  return jsonb_build_object(
    'pet_name', p.name,
    'share_code', p.share_code,
    'sender_email', sender_email,
    'recipient_email', cleaned_email
  );
end;
$$;
revoke all on function pet_private.prepare_pet_email_invitation(uuid, text) from public, anon, authenticated;
grant execute on function pet_private.prepare_pet_email_invitation(uuid, text) to authenticated;

create function public.prepare_pet_email_invitation(target uuid, email text)
returns jsonb
language sql security invoker set search_path = ''
as $$
  select pet_private.prepare_pet_email_invitation(target, email)
$$;
revoke all on function public.prepare_pet_email_invitation(uuid, text) from public, anon;
grant execute on function public.prepare_pet_email_invitation(uuid, text) to authenticated;
