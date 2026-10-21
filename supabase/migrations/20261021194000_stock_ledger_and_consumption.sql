
-- Stock ledger V1: preserve legacy pet JSON, backfill once, then transact in normalized tables.
create table if not exists public.stock_items (
 id uuid primary key default gen_random_uuid(),
 pet_id uuid not null references public.pets(id) on delete cascade,
 name text not null check (length(btrim(name)) between 1 and 120),
 category text not null default 'Прочее' check(length(category) between 1 and 60),
 current_quantity numeric(16,3) not null default 0 check(current_quantity >= 0),
 unit text not null check(unit in ('г','мл','шт.','таблетки','капсулы','порции')),
 display_unit text not null check(display_unit in ('г','кг','мл','л','шт.','таблетки','капсулы','порции')),
 low_stock_threshold numeric(16,3) not null default 0 check(low_stock_threshold >= 0),
 reference_quantity numeric(16,3) not null default 0 check(reference_quantity >= 0),
 note text not null default '' check(length(note)<=3000),
 notifications_enabled boolean not null default true,
 legacy_food boolean not null default false,
 created_by uuid references auth.users(id) on delete set null,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 archived_at timestamptz,
 unique(id,pet_id)
);
create unique index if not exists stock_one_legacy_food on public.stock_items(pet_id) where legacy_food and archived_at is null;
create index if not exists stock_items_pet on public.stock_items(pet_id,archived_at,created_at);

create table if not exists public.stock_consumption_rules (
 id uuid primary key default gen_random_uuid(),
 stock_item_id uuid not null references public.stock_items(id) on delete cascade,
 amount numeric(16,3) not null check(amount>0),
 unit text not null check(unit in ('г','мл','шт.','таблетки','капсулы','порции')),
 frequency text not null check(frequency in ('daily','weekly','monthly')),
 interval_count integer not null default 1 check(interval_count between 1 and 366),
 days_of_week integer[] not null default '{}',
 day_of_month integer check(day_of_month between 1 and 31),
 starts_on date not null,
 ends_on date,
 timezone text not null default 'Europe/Moscow',
 enabled boolean not null default false,
 last_processed_on date,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 check(ends_on is null or ends_on>=starts_on),
 check(days_of_week <@ array[1,2,3,4,5,6,7]::integer[])
);
create unique index if not exists stock_one_enabled_rule on public.stock_consumption_rules(stock_item_id) where enabled;
create index if not exists stock_rules_due on public.stock_consumption_rules(enabled,last_processed_on) where enabled;

create table if not exists public.stock_transactions (
 id uuid primary key default gen_random_uuid(),
 stock_item_id uuid not null references public.stock_items(id) on delete cascade,
 type text not null check(type in ('add','manual_use','automatic_use','correction')),
 amount numeric(16,3) not null check(amount>=0),
 direction text not null check(direction in ('in','out')),
 applied_amount numeric(16,3) not null default 0 check(applied_amount>=0),
 shortage numeric(16,3) not null default 0 check(shortage>=0),
 resulting_quantity numeric(16,3) not null check(resulting_quantity>=0),
 occurred_at timestamptz not null default now(),
 consumption_rule_id uuid references public.stock_consumption_rules(id) on delete set null,
 scheduled_for date,
 external_key text check(length(external_key)<=150),
 created_by uuid references auth.users(id) on delete set null,
 comment text not null default '' check(length(comment)<=3000),
 created_at timestamptz not null default now(),
 check(type <> 'automatic_use' or (consumption_rule_id is not null and scheduled_for is not null)),
 unique(consumption_rule_id,scheduled_for),
 unique(stock_item_id,external_key)
);
create index if not exists stock_transactions_item_history on public.stock_transactions(stock_item_id,occurred_at desc);

alter table public.stock_items enable row level security;
alter table public.stock_consumption_rules enable row level security;
alter table public.stock_transactions enable row level security;
revoke all on public.stock_items, public.stock_consumption_rules, public.stock_transactions from public,anon,authenticated;
grant select on public.stock_items, public.stock_consumption_rules, public.stock_transactions to authenticated;
create policy stock_member_read on public.stock_items for select to authenticated
 using(pet_private.member_role(pet_id) is not null);
create policy stock_rule_member_read on public.stock_consumption_rules for select to authenticated
 using(exists(select 1 from public.stock_items i where i.id=stock_item_id and pet_private.member_role(i.pet_id) is not null));
create policy stock_history_member_read on public.stock_transactions for select to authenticated
 using(exists(select 1 from public.stock_items i where i.id=stock_item_id and pet_private.member_role(i.pet_id) is not null));

-- Keep quantities in base units; preferences determine UI display only.
create or replace function pet_private.stock_base_unit(u text) returns text
language plpgsql immutable security invoker set search_path='' as $$
begin
 if u in ('г','кг') then return 'г'; end if;
 if u in ('мл','л') then return 'мл'; end if;
 if u in ('шт.','таблетки','капсулы','порции') then return u; end if;
 raise exception 'Недопустимая единица измерения' using errcode='22023';
end $$;
create or replace function pet_private.stock_to_base(n numeric,u text) returns numeric
language plpgsql immutable security invoker set search_path='' as $$
declare converted numeric;
begin
 if n is null or n < 0 or n > 1000000000 then
  raise exception 'Недопустимое количество' using errcode='22023'; end if;
 perform pet_private.stock_base_unit(u);
 converted:=case when u in ('кг','л') then n*1000 else n end;
 if converted <> round(converted,3) then raise exception 'Не более трёх знаков после запятой в базовых единицах'; end if;
 return converted;
end $$;

-- Shared calendar recurrence conventions: ISO weekdays, interval anchored to starts_on;
-- on monthly dates beyond month's end, use the last day of that month.
create or replace function pet_private.stock_occurs(r public.stock_consumption_rules,d date)
returns boolean language plpgsql stable security invoker set search_path='' as $$
declare day_delta integer; week_index integer; month_delta integer; last_dom integer;
begin
 if d<r.starts_on or (r.ends_on is not null and d>r.ends_on) then return false; end if;
 day_delta:=d-r.starts_on;
 if r.frequency='daily' then return day_delta%r.interval_count=0; end if;
 if r.frequency='weekly' then
  week_index:=(day_delta+extract(isodow from r.starts_on)::int-1)/7;
  return week_index%r.interval_count=0 and extract(isodow from d)::integer=any(r.days_of_week);
 end if;
 month_delta:=(extract(year from d)::int-extract(year from r.starts_on)::int)*12+
    (extract(month from d)::int-extract(month from r.starts_on)::int);
 if month_delta%r.interval_count<>0 then return false; end if;
 last_dom:=extract(day from (date_trunc('month',d)::date+interval '1 month'-interval '1 day'))::int;
 return extract(day from d)::int=least(coalesce(r.day_of_month,extract(day from r.starts_on)::int),last_dom);
end $$;

create or replace function pet_private.process_stock_for_pet(pid uuid)
returns integer language plpgsql security definer set search_path='' as $$
declare r public.stock_consumption_rules; item public.stock_items; d date;
        cutoff date; first_day date; added integer:=0; inserted_id uuid; applied numeric; need numeric;
begin
 perform pg_advisory_xact_lock(hashtextextended('stock:'||pid::text,0));
 for r in select sr.* from public.stock_consumption_rules sr
   join public.stock_items si on si.id=sr.stock_item_id
   where si.pet_id=pid and si.archived_at is null and sr.enabled
   order by sr.id for update of sr
 loop
  select * into item from public.stock_items where id=r.stock_item_id for update;
  cutoff:=(now() at time zone r.timezone)::date;
  if r.ends_on is not null then cutoff:=least(cutoff,r.ends_on); end if;
  first_day:=greatest(r.starts_on,coalesce(r.last_processed_on,r.starts_on-1)+1);
  if cutoff<first_day then continue; end if;
  for d in select generate_series(first_day,cutoff,interval '1 day')::date loop
   if not pet_private.stock_occurs(r,d) then continue; end if;
   applied:=least(item.current_quantity,r.amount);
   need:=r.amount-applied;
   inserted_id:=null;
   insert into public.stock_transactions
    (stock_item_id,type,amount,direction,applied_amount,shortage,resulting_quantity,
     consumption_rule_id,scheduled_for,occurred_at,comment)
   values(r.stock_item_id,'automatic_use',r.amount,'out',applied,need,item.current_quantity-applied,
     r.id,d,(d::timestamp at time zone r.timezone),
     case when need>0 then 'Недостаточно запаса: не хватило '||need||' '||r.unit else '' end)
   on conflict(consumption_rule_id,scheduled_for) do nothing returning id into inserted_id;
   if inserted_id is not null then
    update public.stock_items set current_quantity=current_quantity-applied,updated_at=now() where id=item.id;
    item.current_quantity:=item.current_quantity-applied;
    added:=added+1;
   end if;
  end loop;
  update public.stock_consumption_rules set last_processed_on=cutoff,updated_at=now() where id=r.id;
 end loop;
 return added;
end $$;

create or replace function pet_private.process_all_stocks()
returns integer language plpgsql security definer set search_path='' as $$
declare p record; count_all integer:=0;
begin
 for p in select distinct i.pet_id from public.stock_items i
   join public.stock_consumption_rules r on r.stock_item_id=i.id
   where i.archived_at is null and r.enabled
 loop count_all:=count_all+pet_private.process_stock_for_pet(p.pet_id); end loop;
 return count_all;
end $$;

create or replace function public.stock_snapshot(p_pet uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if auth.uid() is null or pet_private.member_role(p_pet) is null then
  raise exception 'Доступ к запасам запрещён' using errcode='42501'; end if;
 perform pet_private.process_stock_for_pet(p_pet);
 select coalesce(jsonb_agg(to_jsonb(i)||jsonb_build_object(
  'rules',coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at desc) from public.stock_consumption_rules r where r.stock_item_id=i.id),'[]'::jsonb),
  'transactions',coalesce((select jsonb_agg(t.val) from (select to_jsonb(q) as val from public.stock_transactions q where q.stock_item_id=i.id order by q.occurred_at desc,q.created_at desc limit 200) t),'[]'::jsonb)
 ) order by i.created_at,i.id),'[]'::jsonb) into result
 from public.stock_items i where i.pet_id=p_pet and i.archived_at is null;
 return coalesce(result,'[]'::jsonb);
end $$;

create or replace function public.stock_mutate(p_pet uuid,p_action text,p_data jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); item public.stock_items; old_rule public.stock_consumption_rules;
  item_id uuid; uom text; qty numeric; requested numeric; delta numeric; direction text;
  ref text; resulting numeric; d date; dow integer[]; action_id uuid;
begin
 if u is null or pet_private.member_role(p_pet) not in ('owner','editor') then
  raise exception 'Нет права изменять запасы' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended('stock:'||p_pet::text,0));
 if p_action='create' then
  uom:=p_data->>'unit';
  qty:=pet_private.stock_to_base((p_data->>'quantity')::numeric,uom);
  insert into public.stock_items(pet_id,name,category,current_quantity,unit,display_unit,
    low_stock_threshold,reference_quantity,note,created_by,notifications_enabled)
  values(p_pet,btrim(p_data->>'name'),coalesce(nullif(btrim(p_data->>'category'),''),'Прочее'),
    qty,pet_private.stock_base_unit(uom),uom,
    pet_private.stock_to_base(coalesce((p_data->>'threshold')::numeric,0),uom),
    greatest(qty,pet_private.stock_to_base(coalesce((p_data->>'reference_quantity')::numeric,0),uom)),
    coalesce(p_data->>'note',''),u,coalesce((p_data->>'notifications')::boolean,true))
  returning id into item_id;
  if qty>0 then
   insert into public.stock_transactions(stock_item_id,type,amount,direction,applied_amount,resulting_quantity,created_by,comment)
   values(item_id,'correction',qty,'in',qty,qty,u,'Начальный остаток'); end if;
 elsif p_action='shopping_credit' then
  requested:=pet_private.stock_to_base((p_data->>'amount')::numeric,'кг');
  if requested<=0 then raise exception 'Количество должно быть больше нуля'; end if;
  ref:='shopping:'||(p_data->>'purchase_id');
  if length(ref)<11 then raise exception 'Некорректная покупка'; end if;
  select * into item from public.stock_items
   where pet_id=p_pet and legacy_food and archived_at is null for update;
  if not found then
   insert into public.stock_items(pet_id,name,category,unit,display_unit,created_by,legacy_food,reference_quantity)
   values(p_pet,'Корм','Корм','г','кг',u,true,requested) returning * into item;
  end if;
  if not exists(select 1 from public.stock_transactions where stock_item_id=item.id and external_key=ref) then
   update public.stock_items set current_quantity=current_quantity+requested,updated_at=now(),
    reference_quantity=greatest(reference_quantity,current_quantity+requested) where id=item.id;
   insert into public.stock_transactions(stock_item_id,type,amount,direction,applied_amount,resulting_quantity,external_key,created_by,comment)
   values(item.id,'add',requested,'in',requested,item.current_quantity+requested,ref,u,'Пополнение из покупок');
  end if;
 else
  item_id:=(p_data->>'id')::uuid;
  select * into item from public.stock_items where id=item_id and pet_id=p_pet and archived_at is null for update;
  if not found then raise exception 'Запас не найден' using errcode='22023'; end if;
  if p_action in ('add','manual_use','correction') then
   uom:=coalesce(p_data->>'unit',item.display_unit);
   if pet_private.stock_base_unit(uom)<>item.unit then raise exception 'Несовместимая единица измерения'; end if;
   requested:=pet_private.stock_to_base((p_data->>'amount')::numeric,uom);
   if p_action<>'correction' and requested<=0 then raise exception 'Количество должно быть положительным'; end if;
   if p_action='manual_use' then
    qty:=least(requested,item.current_quantity); delta:=-qty;
   elsif p_action='add' then qty:=requested;delta:=qty;
   else delta:=requested-item.current_quantity;qty:=abs(delta);end if;
   direction:=case when delta<0 then 'out' else 'in' end;
   resulting:=item.current_quantity+delta;
   if qty>0 then
    update public.stock_items set current_quantity=resulting,updated_at=now(),
      reference_quantity=greatest(reference_quantity,resulting) where id=item.id;
    insert into public.stock_transactions(stock_item_id,type,amount,direction,applied_amount,shortage,
     resulting_quantity,created_by,comment)
    values(item.id,p_action,case when p_action='manual_use' then requested else qty end,direction,
      qty,case when p_action='manual_use' then requested-qty else 0 end,resulting,u,coalesce(p_data->>'note',''));
   end if;
  elsif p_action='edit' then
   uom:=coalesce(p_data->>'unit',item.display_unit);
   if pet_private.stock_base_unit(uom)<>item.unit then raise exception 'Несовместимая единица измерения'; end if;
   update public.stock_items set name=btrim(p_data->>'name'),
     category=coalesce(nullif(btrim(p_data->>'category'),''),'Прочее'),display_unit=uom,
     low_stock_threshold=pet_private.stock_to_base(coalesce((p_data->>'threshold')::numeric,0),uom),
     note=coalesce(p_data->>'note',''),
     notifications_enabled=coalesce((p_data->>'notifications')::boolean,true),updated_at=now()
    where id=item.id;
  elsif p_action='set_rule' then
   -- Resolve old occurrences before stopping/editing the previous rule.
   perform pet_private.process_stock_for_pet(p_pet);
   update public.stock_consumption_rules set enabled=false,updated_at=now()
    where stock_item_id=item.id and enabled=true;
   if coalesce((p_data->>'enabled')::boolean,false) then
    uom:=coalesce(p_data->>'unit',item.display_unit);
    if pet_private.stock_base_unit(uom)<>item.unit then raise exception 'Несовместимая единица измерения'; end if;
    requested:=pet_private.stock_to_base((p_data->>'amount')::numeric,uom);
    if requested<=0 then raise exception 'Расход должен быть положительным'; end if;
    d:=(p_data->>'starts_on')::date;
    if d< (now() at time zone 'Europe/Moscow')::date - 365 then
      raise exception 'Начало списания не может быть раньше года назад'; end if;
    dow:=array(select jsonb_array_elements_text(coalesce(p_data->'days_of_week','[]'::jsonb))::integer);
    if coalesce(array_length(dow,1),0)=0 then dow:=array[extract(isodow from d)::integer]; end if;
    insert into public.stock_consumption_rules(stock_item_id,amount,unit,frequency,interval_count,
      days_of_week,day_of_month,starts_on,ends_on,enabled)
    values(item.id,requested,item.unit,p_data->>'frequency',coalesce((p_data->>'interval')::int,1),
      dow,coalesce((p_data->>'day_of_month')::int,extract(day from d)::int),d,
      nullif(p_data->>'ends_on','')::date,true);
   end if;
  elsif p_action='archive' then
   perform pet_private.process_stock_for_pet(p_pet);
   update public.stock_consumption_rules set enabled=false,updated_at=now() where stock_item_id=item.id;
   update public.stock_items set archived_at=now(),updated_at=now() where id=item.id;
  else raise exception 'Неизвестная операция'; end if;
 end if;
 return public.stock_snapshot(p_pet);
end $$;

-- All write access occurs inside strictly membership-checked RPCs. Revoke public execute defaults.
revoke all on function public.stock_snapshot(uuid),public.stock_mutate(uuid,text,jsonb) from public,anon;
grant execute on function public.stock_snapshot(uuid),public.stock_mutate(uuid,text,jsonb) to authenticated;
revoke all on function pet_private.process_all_stocks(),pet_private.process_stock_for_pet(uuid),
 pet_private.stock_occurs(public.stock_consumption_rules,date),pet_private.stock_to_base(numeric,text),
 pet_private.stock_base_unit(text) from public,anon,authenticated;

-- Backfill one trustworthy legacy food balance per live pet. No synthetic past consumption.
insert into public.stock_items(pet_id,name,category,current_quantity,unit,display_unit,
 low_stock_threshold,reference_quantity,note,created_by,legacy_food)
select p.id,'Корм','Корм',greatest(coalesce((p.data->>'stock')::numeric,0),0)*1000,'г','кг',0,
 greatest(coalesce((p.data->>'pack')::numeric,0),coalesce((p.data->>'stock')::numeric,0))*1000,
 'Перенесён исходный остаток корма',p.owner_user_id,true
from public.pets p where p.deleted_at is null and
 (coalesce((p.data->>'stock')::numeric,0)>0 or coalesce((p.data->>'ration')::numeric,0)>0)
on conflict do nothing;
insert into public.stock_transactions(stock_item_id,type,amount,direction,applied_amount,resulting_quantity,comment)
select i.id,'correction',i.current_quantity,'in',i.current_quantity,i.current_quantity,'Начальный остаток при миграции'
from public.stock_items i where i.legacy_food and i.current_quantity>0
and not exists(select 1 from public.stock_transactions t where t.stock_item_id=i.id);
insert into public.stock_consumption_rules(stock_item_id,amount,unit,frequency,interval_count,
 starts_on,days_of_week,enabled)
select i.id,(p.data->>'ration')::numeric,'г','daily',1,(now() at time zone 'Europe/Moscow')::date,
 array[extract(isodow from (now() at time zone 'Europe/Moscow')::date)::int],false
from public.stock_items i join public.pets p on p.id=i.pet_id
where i.legacy_food and coalesce((p.data->>'ration')::numeric,0)>0
and not exists(select 1 from public.stock_consumption_rules r where r.stock_item_id=i.id);
-- Process on the server even if nobody opens the app; catch-up on client snapshot is additional insurance.
select cron.schedule('pet-stock-consumption-hourly','15 * * * *','select pet_private.process_all_stocks();');
