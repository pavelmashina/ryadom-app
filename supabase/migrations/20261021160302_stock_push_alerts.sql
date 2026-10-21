
-- Push events for low/empty stock. One alert per condition transition and member.
create table public.stock_alert_states (
 stock_item_id uuid primary key references public.stock_items(id) on delete cascade,
 level text not null default 'normal' check(level in ('normal','low','empty')),
 cycle integer not null default 0,
 updated_at timestamptz not null default now()
);
create table public.stock_notification_deliveries (
 id uuid primary key default gen_random_uuid(),
 stock_item_id uuid not null references public.stock_items(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 level text not null check(level in ('low','empty')),
 cycle integer not null check(cycle>0),
 status text not null default 'pending' check(status in ('pending','processing','sent','failed')),
 attempts integer not null default 0,
 next_attempt_at timestamptz not null default now(),
 claimed_at timestamptz,
 sent_at timestamptz,
 last_error text,
 created_at timestamptz not null default now(),
 unique(stock_item_id,user_id,level,cycle)
);
create index stock_notification_due on public.stock_notification_deliveries(status,next_attempt_at);
create table public.stock_notification_device_deliveries (
 delivery_id uuid not null references public.stock_notification_deliveries(id) on delete cascade,
 subscription_id uuid not null references public.push_subscriptions(id) on delete cascade,
 sent_at timestamptz,
 attempts integer not null default 0,
 last_error text,
 primary key(delivery_id,subscription_id)
);
alter table public.stock_alert_states enable row level security;
alter table public.stock_notification_deliveries enable row level security;
alter table public.stock_notification_device_deliveries enable row level security;
revoke all on public.stock_alert_states,public.stock_notification_deliveries,
 public.stock_notification_device_deliveries from public,anon,authenticated;
grant select,insert,update,delete on public.stock_alert_states,public.stock_notification_deliveries,
 public.stock_notification_device_deliveries to service_role;

create or replace function public.enqueue_due_stock_push() returns integer
language plpgsql security definer set search_path='' as $$
declare i public.stock_items; old_level text; next_level text; next_cycle integer;
 forecast_use numeric; first_day date:=(now() at time zone 'Europe/Moscow')::date;
 created_count integer:=0; inserted_count integer;
begin
 for i in select * from public.stock_items where archived_at is null order by id loop
  -- Future depletion within 3 actual dates, using the server recurrence matcher.
  select coalesce(sum(case when pet_private.stock_occurs(r,dd.d) then r.amount else 0 end),0)
    into forecast_use from public.stock_consumption_rules r
    cross join lateral generate_series(first_day+1,first_day+3,interval '1 day') dd(d)
    where r.stock_item_id=i.id and r.enabled;
  next_level:=case when not i.notifications_enabled then 'normal'
    when i.current_quantity=0 then 'empty'
    when (i.low_stock_threshold>0 and i.current_quantity<=i.low_stock_threshold)
      or (forecast_use>0 and forecast_use>=i.current_quantity) then 'low'
    else 'normal' end;
  insert into public.stock_alert_states(stock_item_id,level,cycle)
   values(i.id,'normal',0) on conflict(stock_item_id) do nothing;
  select level,cycle into old_level,next_cycle from public.stock_alert_states
   where stock_item_id=i.id for update;
  if next_level=old_level then continue; end if;
  if next_level<>'normal' then next_cycle:=next_cycle+1;end if;
  update public.stock_alert_states set level=next_level,cycle=next_cycle,updated_at=now()
   where stock_item_id=i.id;
  if next_level='normal' then continue; end if;
  insert into public.stock_notification_deliveries(stock_item_id,user_id,level,cycle)
   select i.id,m.user_id,next_level,next_cycle from public.pet_members m
   join public.pets p on p.id=m.pet_id
   where m.pet_id=i.pet_id and m.status='active' and p.deleted_at is null
   on conflict(stock_item_id,user_id,level,cycle) do nothing;
  get diagnostics inserted_count=row_count;
  created_count:=created_count+inserted_count;
 end loop;
 return created_count;
end $$;
create or replace function public.claim_due_stock_push(max_jobs integer default 25)
returns table(id uuid,user_id uuid,stock_item_id uuid,pet_id uuid,
 occurrence_at timestamptz,title text,comment text,timezone text)
language sql security definer set search_path='' as $$
with picked as (
 select d.id from public.stock_notification_deliveries d
 where d.attempts<4 and
  ((d.status in ('pending','failed') and d.next_attempt_at<=now())
   or(d.status='processing' and d.claimed_at<now()-interval '5 minutes'))
 order by d.created_at,d.id
 limit least(greatest(max_jobs,1),50) for update skip locked
),
claimed as (
 update public.stock_notification_deliveries d
 set status='processing', attempts=d.attempts+1,claimed_at=now(),
  next_attempt_at=now()+make_interval(secs=>least(3600,60*power(2,d.attempts)::integer))
 from picked where d.id=picked.id
 returning d.*
)
select c.id,c.user_id,c.stock_item_id,i.pet_id,c.created_at,
 case when c.level='empty' then 'Запас закончился · '||i.name else 'Запас заканчивается · '||i.name end,
 case when c.level='empty' then 'Пополните запас.'
 else 'Осталось '||round(i.current_quantity/(case when i.display_unit in ('кг','л') then 1000 else 1 end),3) ||' '||i.display_unit end,
 'Europe/Moscow'::text
from claimed c join public.stock_items i on i.id=c.stock_item_id
$$;
-- Keep queue-only RPCs private to worker key, including automatic grants to PUBLIC.
revoke all on function public.enqueue_due_stock_push(),public.claim_due_stock_push(integer)
 from public,anon,authenticated;
grant execute on function public.enqueue_due_stock_push(),public.claim_due_stock_push(integer) to service_role;
