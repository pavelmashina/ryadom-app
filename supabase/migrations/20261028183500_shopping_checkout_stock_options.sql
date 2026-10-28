-- Checkout of a shopping-list item into an existing or new stock, once per purchase.
-- A repeated client request is idempotent across *all* stock items for this pet.
create or replace function public.checkout_stock_purchase(
  p_pet uuid, p_purchase uuid, p_mode text,
  p_item uuid default null, p_name text default null,
  p_amount numeric default null, p_unit text default null,
  p_category text default 'Прочее'
) returns jsonb
language plpgsql security definer set search_path to ''
as $func$
declare
  u uuid := auth.uid();
  target public.stock_items;
  target_id uuid;
  quantity numeric;
  ref text := 'checkout:' || p_purchase::text;
begin
  if u is null or pet_private.member_role(p_pet) not in ('owner','editor') then
    raise exception 'Нет права изменять запасы' using errcode='42501';
  end if;
  if p_purchase is null then raise exception 'Некорректная покупка'; end if;
  perform pg_advisory_xact_lock(hashtextextended('stock:' || p_pet::text,0));
  if exists (
    select 1 from public.stock_transactions t
    join public.stock_items i on i.id=t.stock_item_id
    where i.pet_id=p_pet and t.external_key=ref
  ) then
    return public.stock_snapshot(p_pet);
  end if;
  if p_mode not in ('existing','new') then raise exception 'Выберите способ учёта покупки'; end if;
  if p_amount is null or p_amount<=0 then raise exception 'Укажите положительное количество'; end if;
  if p_unit is null then raise exception 'Выберите единицу измерения'; end if;
  quantity:=pet_private.stock_to_base(p_amount,p_unit);
  if quantity<=0 then raise exception 'Укажите положительное количество'; end if;
  if p_mode='existing' then
    select * into target from public.stock_items
      where id=p_item and pet_id=p_pet and archived_at is null for update;
    if not found then raise exception 'Выбранный запас не найден'; end if;
    if target.unit <> pet_private.stock_base_unit(p_unit) then
      raise exception 'Несовместимая единица измерения';
    end if;
    target_id:=target.id;
    update public.stock_items set current_quantity=current_quantity+quantity,
      reference_quantity=greatest(reference_quantity,current_quantity+quantity),
      updated_at=now() where id=target_id;
  else
    if nullif(btrim(coalesce(p_name,'')),'') is null or length(btrim(p_name))>120 then
      raise exception 'Укажите название нового запаса до 120 символов';
    end if;
    insert into public.stock_items
      (pet_id,name,category,current_quantity,unit,display_unit,low_stock_threshold,
       reference_quantity,note,created_by,notifications_enabled)
    values (p_pet,btrim(p_name),coalesce(nullif(btrim(p_category),''),'Прочее'),
      quantity,pet_private.stock_base_unit(p_unit),p_unit,0,quantity,'',u,true)
    returning id into target_id;
  end if;
  insert into public.stock_transactions
    (stock_item_id,type,amount,direction,applied_amount,resulting_quantity,
     external_key,created_by,comment)
  select target_id,'add',quantity,'in',quantity,i.current_quantity,
    ref,u,'Пополнение после покупки'
  from public.stock_items i where i.id=target_id;
  return public.stock_snapshot(p_pet);
end
$func$;

revoke all on function public.checkout_stock_purchase(uuid,uuid,text,uuid,text,numeric,text,text) from public,anon;
grant execute on function public.checkout_stock_purchase(uuid,uuid,text,uuid,text,numeric,text,text) to authenticated;
