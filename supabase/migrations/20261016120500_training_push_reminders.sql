-- Personal Web Push reminders for one-off sessions and recurring schedules.
-- Existing calendar-event push tables and workers remain unchanged.
create table public.training_reminders (
  id uuid primary key default gen_random_uuid(),
  pet_id uuid not null references public.pets(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid references public.training_sessions(id) on delete cascade,
  schedule_id uuid references public.training_schedules(id) on delete cascade,
  offset_value integer not null default 0 check (offset_value between 0 and 525600),
  offset_unit text not null default 'minutes' check (offset_unit in ('minutes','hours','days','weeks')),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint training_reminders_exactly_one_target check (
    (session_id is not null and schedule_id is null)
    or (session_id is null and schedule_id is not null)
  )
);
create unique index training_reminder_session_unique
  on public.training_reminders(user_id, session_id) where session_id is not null;
create unique index training_reminder_schedule_unique
  on public.training_reminders(user_id, schedule_id) where schedule_id is not null;
create index training_reminders_pet_idx on public.training_reminders(pet_id);

alter table public.training_reminders enable row level security;
-- These checks also prohibit cross-pet references despite separate FKs.
create policy training_reminders_read on public.training_reminders for select to authenticated
  using (user_id=(select auth.uid()) and pet_private.member_role(pet_id) is not null);
create policy training_reminders_insert on public.training_reminders for insert to authenticated
  with check (
    user_id=(select auth.uid()) and pet_private.member_role(pet_id) is not null
    and (
      (session_id is not null and exists (
        select 1 from public.training_sessions s where s.id=session_id and s.pet_id=pet_id
      ))
      or
      (schedule_id is not null and exists (
        select 1 from public.training_schedules sc where sc.id=schedule_id and sc.pet_id=pet_id
      ))
    )
  );
create policy training_reminders_update on public.training_reminders for update to authenticated
  using (user_id=(select auth.uid()) and pet_private.member_role(pet_id) is not null)
  with check (
    user_id=(select auth.uid()) and pet_private.member_role(pet_id) is not null
    and (
      (session_id is not null and exists (
        select 1 from public.training_sessions s where s.id=session_id and s.pet_id=pet_id
      ))
      or
      (schedule_id is not null and exists (
        select 1 from public.training_schedules sc where sc.id=schedule_id and sc.pet_id=pet_id
      ))
    )
  );
create policy training_reminders_delete on public.training_reminders for delete to authenticated
  using (user_id=(select auth.uid()) and pet_private.member_role(pet_id) is not null);
revoke all on public.training_reminders from public, anon, authenticated;
grant select, insert, update, delete on public.training_reminders to authenticated;

create table public.training_notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  reminder_id uuid not null references public.training_reminders(id) on delete cascade,
  session_id uuid not null references public.training_sessions(id) on delete cascade,
  occurrence_at timestamptz not null,
  offset_minutes integer not null check (offset_minutes between 0 and 525600),
  status text not null default 'pending' check (status in ('pending','processing','sent','failed')),
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null default now(),
  claimed_at timestamptz,
  sent_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  unique(user_id,reminder_id,session_id,occurrence_at)
);
create index training_notification_due_idx
  on public.training_notification_deliveries(status,next_attempt_at);
create table public.training_notification_device_deliveries (
  delivery_id uuid not null references public.training_notification_deliveries(id) on delete cascade,
  subscription_id uuid not null references public.push_subscriptions(id) on delete cascade,
  sent_at timestamptz,
  attempts integer not null default 0,
  last_error text,
  primary key(delivery_id,subscription_id)
);
alter table public.training_notification_deliveries enable row level security;
alter table public.training_notification_device_deliveries enable row level security;
create policy training_deliveries_self_read on public.training_notification_deliveries
  for select to authenticated using (user_id=(select auth.uid()));
revoke all on public.training_notification_deliveries,
  public.training_notification_device_deliveries from public,anon,authenticated;
grant select on public.training_notification_deliveries to authenticated;
-- device-level status must remain service-role only.

create function public.enqueue_due_training_push() returns integer
language plpgsql security definer set search_path='' as $$
declare count_added integer; moment timestamptz:=now();
begin
  with eligible as (
    select s.id as session_id,s.scheduled_at,r.id as reminder_id,r.user_id,
      r.offset_value * case r.offset_unit
        when 'weeks' then 10080 when 'days' then 1440
        when 'hours' then 60 else 1 end as offset_minutes
    from public.training_reminders r
    join public.training_sessions s
      on s.pet_id=r.pet_id
      and (r.session_id=s.id or (r.schedule_id is not null and r.schedule_id=s.schedule_id))
    left join public.training_schedules sc on sc.id=s.schedule_id
    join public.pets p on p.id=r.pet_id and p.deleted_at is null
    join public.pet_members m on m.pet_id=r.pet_id and m.user_id=r.user_id
      and m.status='active'
    where r.enabled and s.status='planned' and s.scheduled_at is not null
      and (s.schedule_id is null or sc.is_active)
  )
  insert into public.training_notification_deliveries
    (user_id,reminder_id,session_id,occurrence_at,offset_minutes)
  select user_id,reminder_id,session_id,scheduled_at,offset_minutes
  from eligible
  where scheduled_at-(offset_minutes*interval '1 minute')
    between moment-interval '2 minutes' and moment+interval '1 minute'
  on conflict(user_id,reminder_id,session_id,occurrence_at) do nothing;
  get diagnostics count_added=row_count;
  return count_added;
end $$;

-- Recheck permissions, schedule, timing and reminder configuration BEFORE claiming
-- so cancelled, completed, moved or revoked sessions cannot dispatch queued jobs.
create function public.claim_due_training_push(max_jobs integer default 25)
returns table(id uuid,user_id uuid,session_id uuid,reminder_id uuid,
  occurrence_at timestamptz,title text,comment text,timezone text)
language sql security definer set search_path='' as $$
with picked as (
  select d.id
  from public.training_notification_deliveries d
  join public.training_reminders r on r.id=d.reminder_id and r.user_id=d.user_id
  join public.training_sessions s on s.id=d.session_id and s.pet_id=r.pet_id
  left join public.training_schedules sc on sc.id=s.schedule_id
  join public.pets p on p.id=r.pet_id and p.deleted_at is null
  join public.pet_members m on m.pet_id=r.pet_id and m.user_id=d.user_id
    and m.status='active'
  where d.attempts<4 and
    ((d.status in ('pending','failed') and d.next_attempt_at<=now())
     or (d.status='processing' and d.claimed_at<now()-interval '5 minutes'))
    and r.enabled and s.status='planned'
    and s.scheduled_at=d.occurrence_at
    and (s.schedule_id is null or sc.is_active)
    and (r.session_id=s.id or (r.schedule_id is not null and r.schedule_id=s.schedule_id))
    and d.offset_minutes=r.offset_value *
      case r.offset_unit when 'weeks' then 10080 when 'days' then 1440
        when 'hours' then 60 else 1 end
  order by d.created_at,d.id
  limit least(greatest(max_jobs,1),50)
  for update of d skip locked
),
claimed as (
  update public.training_notification_deliveries d
  set status='processing', attempts=d.attempts+1, claimed_at=now(),
    next_attempt_at=now()+make_interval(secs=>least(3600,60*power(2,d.attempts)::integer))
  from picked where d.id=picked.id
  returning d.id,d.user_id,d.session_id,d.reminder_id,d.occurrence_at
)
select c.id,c.user_id,c.session_id,c.reminder_id,c.occurrence_at,
  coalesce(nullif(s.name,''),nullif(sc.name,''),'Тренировка') as title,
  s.comment,coalesce(sc.timezone,'Europe/Moscow') as timezone
from claimed c
join public.training_sessions s on s.id=c.session_id
left join public.training_schedules sc on sc.id=s.schedule_id
$$;
revoke all on function public.enqueue_due_training_push(),
  public.claim_due_training_push(integer) from public,anon,authenticated;
grant execute on function public.enqueue_due_training_push(),
  public.claim_due_training_push(integer) to service_role;
