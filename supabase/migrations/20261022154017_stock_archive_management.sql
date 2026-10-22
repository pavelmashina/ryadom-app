-- Archived stock listing, guarded restore and owner-only hard delete.
CREATE OR REPLACE FUNCTION public.stock_archive(p_pet uuid, p_action text DEFAULT 'list'::text, p_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  member text;
  entry public.stock_items;
  archived jsonb;
begin
  member := pet_private.member_role(p_pet);
  if auth.uid() is null or member is null then
    raise exception 'Доступ к архиву запрещён' using errcode='42501';
  end if;
  if p_action not in ('list','restore','delete') then
    raise exception 'Неизвестная операция с архивом' using errcode='22023';
  end if;
  if p_action <> 'list' then
    if member not in ('owner','editor') then
      raise exception 'Нет права изменять запасы' using errcode='42501';
    end if;
    if p_action = 'delete' and member <> 'owner' then
      raise exception 'Удалять архивные запасы может только владелец' using errcode='42501';
    end if;
    perform pg_advisory_xact_lock(hashtextextended('stock:' || p_pet::text,0));
    select * into entry from public.stock_items
      where id=p_id and pet_id=p_pet and archived_at is not null for update;
    if not found then
      raise exception 'Архивный запас не найден' using errcode='22023';
    end if;
    if p_action = 'restore' then
      -- Only one active legacy food stock is allowed. Restore historical stock
      -- as a regular item when a newer legacy food stock already exists.
      update public.stock_items
        set archived_at=null,
            legacy_food=case when entry.legacy_food and exists(
              select 1 from public.stock_items x
              where x.pet_id=p_pet and x.id<>entry.id
                and x.legacy_food and x.archived_at is null
            ) then false else entry.legacy_food end,
            updated_at=now()
        where id=entry.id;
      -- Rules were disabled during archive and remain disabled after restore.
    else
      delete from public.stock_items where id=entry.id and pet_id=p_pet;
      -- Rules, history, and stock notification rows cascade with the item.
    end if;
  end if;

  select coalesce(jsonb_agg(
    to_jsonb(i)||jsonb_build_object(
      'rules',coalesce((
        select jsonb_agg(to_jsonb(r) order by r.created_at desc)
        from public.stock_consumption_rules r where r.stock_item_id=i.id
      ),'[]'::jsonb),
      'transactions',coalesce((
        select jsonb_agg(t.val)
        from (select to_jsonb(q) as val from public.stock_transactions q
              where q.stock_item_id=i.id
              order by q.occurred_at desc,q.created_at desc limit 200) t
      ),'[]'::jsonb)
    ) order by i.archived_at desc,i.id),'[]'::jsonb) into archived
  from public.stock_items i
  where i.pet_id=p_pet and i.archived_at is not null;
  return coalesce(archived,'[]'::jsonb);
end $function$

revoke all on function public.stock_archive(uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.stock_archive(uuid,text,uuid) to authenticated;
