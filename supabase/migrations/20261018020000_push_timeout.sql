-- Give the push function up to 15 seconds (it can take a few seconds to wake up).
create or replace function public.push_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare secret text;
begin
  select decrypted_secret into secret from vault.decrypted_secrets where name = 'push_hook_secret';
  if secret is null then return new; end if;
  perform net.http_post(
    url := 'https://kxqsaqunrsbtvrenqnnh.supabase.co/functions/v1/push',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-hook-secret', secret),
    body := jsonb_build_object('table', tg_table_name, 'record', to_jsonb(new)),
    timeout_milliseconds := 15000
  );
  return new;
exception when others then
  return new;
end $$;
revoke all on function public.push_notify() from public, anon, authenticated;
