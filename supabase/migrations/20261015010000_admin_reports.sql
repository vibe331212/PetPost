-- Admins: people who run PetPost. They get a Reports tab where they can read every report,
-- dismiss it, or remove the reported post. Only the database owner can add or remove admins
-- (in the Supabase dashboard or with SQL); there is no way to do it from the app.
create table public.admins (
  user_id uuid primary key references public.profiles on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.admins enable row level security;
-- You can only check whether you yourself are an admin.
create policy "see if you are an admin" on public.admins for select to authenticated using (user_id = auth.uid());

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;
revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

-- Every report with the details an admin needs, newest first. Admins see reported posts even if
-- the post's author blocked them.
create or replace function public.admin_reports()
returns table (
  id bigint, reason text, created_at timestamptz,
  reporter text, reported_user text,
  post_id uuid, post_author text, post_data jsonb, post_created_at timestamptz
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Only admins can see reports'; end if;
  return query
    select r.id, r.reason, r.created_at,
           rp.username, ru.username,
           p.id, pa.username, p.data, p.created_at
    from public.reports r
    left join public.profiles rp on rp.id = r.reporter
    left join public.profiles ru on ru.id = r.user_id
    left join public.posts p on p.id = r.post_id
    left join public.profiles pa on pa.id = p.author
    order by r.created_at desc
    limit 500;
end $$;
revoke all on function public.admin_reports() from public, anon;
grant execute on function public.admin_reports() to authenticated;

-- Dismiss reports once they have been looked at.
create policy "admins can dismiss reports" on public.reports for delete to authenticated using (public.is_admin());

-- Remove a reported post, with its licks, comments and reports. Its photo or video file stays in
-- storage, but nothing in the app links to it any more.
create or replace function public.admin_delete_post(target uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Only admins can remove posts'; end if;
  delete from public.reports where post_id = target;
  delete from public.posts where id = target;
end $$;
revoke all on function public.admin_delete_post(uuid) from public, anon;
grant execute on function public.admin_delete_post(uuid) to authenticated;
