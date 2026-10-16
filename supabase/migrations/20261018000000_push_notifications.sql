-- Real phone notifications (web push). Each phone that turns them on saves its push address here.
-- When someone licks, barks, follows, reports or posts, the database pings the `push` function,
-- which sends the notification to the right people's phones.

create table public.push_subscriptions (
  endpoint text primary key,
  user_id uuid not null references public.profiles on delete cascade,
  subscription jsonb not null,
  created_at timestamptz not null default now()
);
create index push_subscriptions_user on public.push_subscriptions (user_id);
alter table public.push_subscriptions enable row level security;
-- Nobody can read push addresses from the app. Saving and removing go through the functions below.

-- Save this phone's push address for you. If someone else signed in on this phone before, it moves to you.
create or replace function public.save_push_subscription(sub jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or coalesce(sub->>'endpoint', '') = '' then raise exception 'Not signed in'; end if;
  insert into public.push_subscriptions (endpoint, user_id, subscription)
  values (sub->>'endpoint', auth.uid(), sub)
  on conflict (endpoint) do update set user_id = excluded.user_id, subscription = excluded.subscription, created_at = now();
end $$;
revoke all on function public.save_push_subscription(jsonb) from public, anon;
grant execute on function public.save_push_subscription(jsonb) to authenticated;

-- Stop sending to this phone (you turned them off or signed out).
create or replace function public.remove_push_subscription(target text) returns void
language sql security definer set search_path = public as $$
  delete from public.push_subscriptions where endpoint = target and user_id = auth.uid();
$$;
revoke all on function public.remove_push_subscription(text) from public, anon;
grant execute on function public.remove_push_subscription(text) to authenticated;

-- Ping the push function about something new. The shared secret lives in the Vault (set by the owner,
-- never in this file). If anything goes wrong, the lick/bark/post still saves; only the ping is skipped.
create extension if not exists pg_net with schema extensions;

create or replace function public.push_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare secret text;
begin
  select decrypted_secret into secret from vault.decrypted_secrets where name = 'push_hook_secret';
  if secret is null then return new; end if;
  perform net.http_post(
    url := 'https://kxqsaqunrsbtvrenqnnh.supabase.co/functions/v1/push',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-hook-secret', secret),
    body := jsonb_build_object('table', tg_table_name, 'record', to_jsonb(new))
  );
  return new;
exception when others then
  return new;
end $$;
revoke all on function public.push_notify() from public, anon, authenticated;

create trigger push_on_lick after insert on public.licks for each row execute function public.push_notify();
create trigger push_on_comment after insert on public.comments for each row execute function public.push_notify();
create trigger push_on_follow after insert on public.follows for each row execute function public.push_notify();
create trigger push_on_report after insert on public.reports for each row execute function public.push_notify();
create trigger push_on_post after insert on public.posts for each row execute function public.push_notify();
