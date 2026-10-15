
create extension if not exists pg_cron;
create extension if not exists pg_net;
select cron.schedule('pet-push-worker-every-minute', '* * * * *', $job$
  select net.http_post(
    url:='https://vbnkziodmyykyazdcrwl.supabase.co/functions/v1/pet-push-worker',
    headers:=jsonb_build_object(
      'Content-Type','application/json',
      'x-cron-token',(select decrypted_secret from vault.decrypted_secrets where name='pet_push_cron_token')
    ),
    body:='{}'::jsonb,
    timeout_milliseconds:=10000
  );
$job$);
