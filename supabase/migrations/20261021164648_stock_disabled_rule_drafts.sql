-- Allow changing stored consumption rate while automatic deductions stay disabled.
-- Existing rules and historical stock transactions are preserved.
do $patch$
declare definition text;
begin
 definition := pg_get_functiondef('public.stock_mutate(uuid,text,jsonb)'::regprocedure);
 if position('if coalesce((p_data->>''enabled'')::boolean,false) then' in definition)=0
    or position('nullif(p_data->>''ends_on'','''')::date,true);' in definition)=0 then
  raise exception 'stock_mutate changed unexpectedly; refusing to patch';
 end if;
 definition:=replace(definition,
  'if coalesce((p_data->>''enabled'')::boolean,false) then',
  'if coalesce((p_data->>''enabled'')::boolean,false) or p_data ? ''amount'' then');
 definition:=replace(definition,
  'nullif(p_data->>''ends_on'','''')::date,true);',
  'nullif(p_data->>''ends_on'','''')::date,coalesce((p_data->>''enabled'')::boolean,false));');
 execute definition;
end $patch$;
