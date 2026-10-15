
-- Server-side Web Push queue, per-device idempotency and public VAPID metadata.
create table if not exists public.push_public_config (
 id boolean primary key default true check(id),
 public_key text not null check(length(public_key) between 80 and 128),
 updated_at timestamptz not null default now()
);
alter table public.push_public_config enable row level security;
create policy "read_public_vapid" on public.push_public_config
for select to anon,authenticated using(true);
grant select on public.push_public_config to anon,authenticated;
revoke insert,update,delete on public.push_public_config from anon,authenticated;

create table if not exists public.notification_device_deliveries (
 delivery_id uuid not null references public.notification_deliveries(id) on delete cascade,
 subscription_id uuid not null references public.push_subscriptions(id) on delete cascade,
 sent_at timestamptz,
 attempts integer not null default 0,
 last_error text,
 primary key(delivery_id,subscription_id)
);
alter table public.notification_device_deliveries enable row level security;
-- No public RLS policies: only backend service-role can inspect and mutate device deliveries.
revoke all on public.notification_device_deliveries from public,anon,authenticated;
alter table public.event_reminders add column if not exists source text not null default 'native'
 check(source in ('native','legacy'));
create unique index if not exists event_reminders_legacy_unique
 on public.event_reminders(event_id,user_id) where source='legacy';
-- Verify a random cron capability using a value stored only in Vault.
create or replace function public.push_worker_verify(token text)
returns boolean language sql stable security definer set search_path='' as $$
select token is not null and length(token)>20 and exists(
 select 1 from vault.decrypted_secrets
 where name='pet_push_cron_token' and decrypted_secret=token
);
$$;
create or replace function public.push_worker_vapid()
returns jsonb language sql stable security definer set search_path='' as $$
select jsonb_build_object(
 'publicKey',(select public_key from public.push_public_config where id=true),
 'privateKey',(select decrypted_secret from vault.decrypted_secrets
     where name='pet_vapid_private' limit 1)
);
$$;

create or replace function public.enqueue_due_push()
returns integer language plpgsql security definer set search_path='' as $$
declare count_added integer; moment timestamptz:=now();
begin
 with active_reminders as (
   select rem.id reminder_id,rem.user_id,rem.event_id,rem.offset_value,
     rem.offset_unit,e.pet_id,e.starts_on,e.time_of_day,e.timezone,
     e.recurrence_rule_id,
     rem.offset_value *
     case rem.offset_unit when 'weeks' then 10080 when 'days' then 1440
          when 'hours' then 60 else 1 end as offset_minutes
   from public.event_reminders rem
   join public.calendar_events e on e.id=rem.event_id and e.pet_id=rem.pet_id
   join public.pets p on p.id=e.pet_id and p.deleted_at is null
   join public.pet_members m on m.pet_id=e.pet_id and m.user_id=rem.user_id
      and m.status='active'
   where rem.enabled and rem.offset_value *
     case rem.offset_unit when 'weeks' then 10080 when 'days' then 1440
          when 'hours' then 60 else 1 end <=525600
 ),
 occurrences as (
   select ar.*, d.on_day::date occurrence_day,
      ((d.on_day::date+coalesce(ar.time_of_day,time '09:00'))
        at time zone ar.timezone) as occurrence_at
   from active_reminders ar
   cross join lateral generate_series(
     ((moment+(ar.offset_minutes*interval '1 minute'))
        at time zone ar.timezone)::date-1,
     ((moment+(ar.offset_minutes*interval '1 minute'))
        at time zone ar.timezone)::date+1,
      interval '1 day') d(on_day)
 ),
 due as (
 select o.user_id,o.event_id,o.occurrence_at,o.reminder_id
 from occurrences o
 where o.occurrence_at-(o.offset_minutes*interval '1 minute')
         >= moment-interval '2 minutes'
   and o.occurrence_at-(o.offset_minutes*interval '1 minute')
         <= moment+interval '1 minute'
   and (
     (o.recurrence_rule_id is null and o.occurrence_day=o.starts_on)
     or (o.recurrence_rule_id is not null and
         pet_private.recurrence_occurs(o.recurrence_rule_id,o.occurrence_day))
   )
 )
 insert into public.notification_deliveries(user_id,event_id,occurrence_at,reminder_id)
 select user_id,event_id,occurrence_at,reminder_id from due
 on conflict(user_id,event_id,occurrence_at,reminder_id) do nothing;
 get diagnostics count_added=row_count;
 return count_added;
end $$;

create or replace function public.claim_due_push(max_jobs integer default 30)
returns table(id uuid,user_id uuid,event_id uuid,reminder_id uuid,
  occurrence_at timestamptz,title text,comment text,timezone text)
language sql security definer set search_path='' as $$
with picked as (
 select d.id from public.notification_deliveries d
 where d.attempts<4 and
  (
    (d.status in ('pending','failed') and d.next_attempt_at<=now())
    or (d.status='processing' and d.claimed_at<now()-interval '5 minutes')
  )
 order by d.created_at,d.id
 limit least(greatest(max_jobs,1),50)
 for update skip locked
),
claimed as (
 update public.notification_deliveries d
 set status='processing', attempts=d.attempts+1,
     claimed_at=now(),
     next_attempt_at=now()+make_interval(secs=>least(3600,60*power(2,d.attempts)::integer))
 from picked where d.id=picked.id
 returning d.id,d.user_id,d.event_id,d.reminder_id,d.occurrence_at
)
select c.id,c.user_id,c.event_id,c.reminder_id,c.occurrence_at,
       e.title,e.comment,e.timezone
from claimed c join public.calendar_events e on e.id=c.event_id
$$;
-- Only Supabase server key may call these functions via RPC.
revoke all on function public.push_worker_verify(text),
 public.push_worker_vapid(),public.enqueue_due_push(),
 public.claim_due_push(integer) from public,anon,authenticated;
grant execute on function public.push_worker_verify(text),
 public.push_worker_vapid(),public.enqueue_due_push(),
 public.claim_due_push(integer) to service_role;
