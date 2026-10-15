
-- Non-destructive calendar + notification foundations.
create table if not exists public.recurrence_rules (
  id uuid primary key default gen_random_uuid(),
  pet_id uuid not null references public.pets(id) on delete cascade,
  source_type text not null check (source_type in ('event','training')),
  source_id uuid not null,
  frequency text not null check (frequency in ('daily','weekly','monthly','yearly')),
  interval integer not null default 1 check (interval between 1 and 366),
  days_of_week smallint[] not null default '{}'::smallint[]
    check(days_of_week <@ array[1,2,3,4,5,6,7]::smallint[]),
  day_of_month smallint check (day_of_month between 1 and 31),
  starts_on date not null,
  end_type text not null default 'never' check (end_type in ('never','date','count')),
  ends_on date,
  occurrence_count integer check (occurrence_count between 1 and 10000),
  timezone text not null default 'Europe/Moscow',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(id,pet_id),
  unique(source_type,source_id),
  check (end_type <> 'date' or (ends_on is not null and ends_on >= starts_on)),
  check (end_type <> 'count' or occurrence_count is not null)
);
create index if not exists recurrence_rules_pet_idx on public.recurrence_rules(pet_id);

create table if not exists public.calendar_events (
  id uuid primary key,
  pet_id uuid not null references public.pets(id) on delete cascade,
  type text not null default 'event' check (type in ('event','reminder')),
  category text not null default 'care' check (category in ('care','training','health')),
  title text not null check (length(trim(title)) between 1 and 120),
  comment text not null default '' check (length(comment)<=5000),
  starts_on date not null,
  time_of_day time,
  timezone text not null default 'Europe/Moscow',
  ends_at timestamptz,
  recurrence_rule_id uuid references public.recurrence_rules(id) on delete set null,
  linked_record text,
  source text not null default 'legacy' check (source in ('legacy','native')),
  legacy_payload jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(id,pet_id),
  check(jsonb_typeof(legacy_payload)='object')
);
create index if not exists calendar_events_pet_idx on public.calendar_events(pet_id,starts_on);

create table if not exists public.calendar_event_exceptions (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null,
  pet_id uuid not null,
  original_on date not null,
  moved_on date,
  cancelled boolean not null default false,
  override_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(event_id,original_on),
  foreign key(event_id,pet_id) references public.calendar_events(id,pet_id) on delete cascade
);
create index if not exists calendar_exceptions_pet_idx on public.calendar_event_exceptions(pet_id,original_on);

create table if not exists public.calendar_event_completions (
  event_id uuid not null,
  pet_id uuid not null,
  occurrence_on date not null,
  done boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(event_id,occurrence_on),
  foreign key(event_id,pet_id) references public.calendar_events(id,pet_id) on delete cascade
);

create table if not exists public.event_reminders (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null,
  pet_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  offset_value integer not null default 0 check(offset_value between 0 and 525600),
  offset_unit text not null default 'minutes' check(offset_unit in ('minutes','hours','days','weeks')),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key(event_id,pet_id) references public.calendar_events(id,pet_id) on delete cascade
);
create index if not exists event_reminders_user_idx on public.event_reminders(user_id,event_id);
create index if not exists event_reminders_event_idx on public.event_reminders(event_id) where enabled;

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  device_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(length(endpoint) between 20 and 2048),
  check(length(p256dh) between 20 and 512),
  check(length(auth) between 8 and 512)
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions(user_id);

create table if not exists public.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  event_id uuid not null references public.calendar_events(id) on delete cascade,
  occurrence_at timestamptz not null,
  reminder_id uuid not null references public.event_reminders(id) on delete cascade,
  status text not null default 'pending' check(status in ('pending','processing','sent','failed')),
  attempts integer not null default 0 check(attempts >= 0),
  next_attempt_at timestamptz not null default now(),
  claimed_at timestamptz,
  sent_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  unique(user_id,event_id,occurrence_at,reminder_id)
);
create index if not exists notification_deliveries_due_idx
  on public.notification_deliveries(status,next_attempt_at);

-- Only members of the relevant live pet can inspect event data.
alter table public.recurrence_rules enable row level security;
alter table public.calendar_events enable row level security;
alter table public.calendar_event_exceptions enable row level security;
alter table public.calendar_event_completions enable row level security;
alter table public.event_reminders enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.notification_deliveries enable row level security;

create policy "recurrence_member_read" on public.recurrence_rules
for select to authenticated using (pet_private.member_role(pet_id) is not null);
create policy "events_member_read" on public.calendar_events
for select to authenticated using (pet_private.member_role(pet_id) is not null);
create policy "events_member_insert" on public.calendar_events
for insert to authenticated with check (pet_private.member_role(pet_id) is not null);
create policy "events_member_update" on public.calendar_events
for update to authenticated using (pet_private.member_role(pet_id) is not null)
with check (pet_private.member_role(pet_id) is not null);
create policy "events_member_delete" on public.calendar_events
for delete to authenticated using (pet_private.member_role(pet_id) is not null);
create policy "exceptions_member_read" on public.calendar_event_exceptions
for select to authenticated using(pet_private.member_role(pet_id) is not null);
create policy "completions_member_read" on public.calendar_event_completions
for select to authenticated using(pet_private.member_role(pet_id) is not null);
create policy "reminders_self_read" on public.event_reminders
for select to authenticated using(user_id=(select auth.uid()) and pet_private.member_role(pet_id) is not null);
create policy "reminders_self_insert" on public.event_reminders
for insert to authenticated with check(user_id=(select auth.uid()) and pet_private.member_role(pet_id) is not null);
create policy "reminders_self_update" on public.event_reminders
for update to authenticated using(user_id=(select auth.uid()) and pet_private.member_role(pet_id) is not null)
with check(user_id=(select auth.uid()) and pet_private.member_role(pet_id) is not null);
create policy "reminders_self_delete" on public.event_reminders
for delete to authenticated using(user_id=(select auth.uid()) and pet_private.member_role(pet_id) is not null);
create policy "push_self_read" on public.push_subscriptions
for select to authenticated using(user_id=(select auth.uid()));
create policy "push_self_insert" on public.push_subscriptions
for insert to authenticated with check(user_id=(select auth.uid()));
create policy "push_self_update" on public.push_subscriptions
for update to authenticated using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));
create policy "push_self_delete" on public.push_subscriptions
for delete to authenticated using(user_id=(select auth.uid()));
create policy "deliveries_self_read" on public.notification_deliveries
for select to authenticated using(user_id=(select auth.uid()));

-- Access to some rows is deliberately read-only; writes go through
-- authenticated, version-controlled state RPC or the backend service role.
grant select on public.recurrence_rules,public.calendar_event_exceptions,
 public.calendar_event_completions,public.notification_deliveries to authenticated;
grant select,insert,update,delete on public.calendar_events,
 public.event_reminders,public.push_subscriptions to authenticated;
revoke all on public.recurrence_rules,public.calendar_events,
 public.calendar_event_exceptions,public.calendar_event_completions,
 public.event_reminders,public.push_subscriptions,
 public.notification_deliveries from anon;
