-- Reduce full-pet saves to changed normalized sections only.
-- Old clients omit these flags: coalesce(...,true) preserves legacy behavior.
do $patch$
declare body text;
begin
  body:=pg_get_functiondef('pet_private.save_state(jsonb,jsonb,text)'::regprocedure);
  if position('  update public.commands set archived=true' in body)=0
    or position('  for s in select * from jsonb_array_elements(coalesce(p->''workouts'',''[]'')) loop' in body)=0
    or position('  -- Remove results before replacing a training;' in body)=0
    or position('  if p ? ''trainingSchedules'' then' in body)=0
    then raise exception 'Save-state function changed: refusing unsafe patch';end if;

  body:=replace(body,
    '  update public.commands set archived=true',
    '  if coalesce((item->>''updateCommands'')::boolean,true) then' || chr(10) ||
    '  update public.commands set archived=true');
  body:=replace(body,
    '  for s in select * from jsonb_array_elements(coalesce(p->''workouts'',''[]'')) loop',
    '  end if;' || chr(10) ||
    '  for s in select * from jsonb_array_elements(coalesce(p->''workouts'',''[]'')) loop');

  body:=replace(body,
    '  -- Remove results before replacing a training;',
    '  if coalesce((item->>''updateWorkouts'')::boolean,true) then' || chr(10) ||
    '  -- Remove results before replacing a training;');
  body:=replace(body,
    '  if p ? ''trainingSchedules'' then',
    '  end if;' || chr(10) ||
    '  if coalesce((item->>''updateSchedules'')::boolean,true) and p ? ''trainingSchedules'' then');

  if body=pg_get_functiondef('pet_private.save_state(jsonb,jsonb,text)'::regprocedure)
     or position('if coalesce((item->>''updateCommands'')::boolean,true)' in body)=0
     or position('if coalesce((item->>''updateWorkouts'')::boolean,true)' in body)=0
     then raise exception 'Save-state patch did not apply'; end if;
  execute body;
end $patch$;

-- Validated client changes are still checked against the same full-pet
-- revision and membership permissions. No new public RPC is introduced.
