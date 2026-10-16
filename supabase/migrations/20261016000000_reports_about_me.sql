-- Let people see reports about their own account or posts, so PetPost can tell them.
-- It never says who sent the report, so nobody gets picked on for reporting.
create or replace function public.reports_about_me()
returns table (id bigint, reason text, created_at timestamptz, post_id uuid)
language sql stable security definer set search_path = public as $$
  select r.id, r.reason, r.created_at, r.post_id
  from public.reports r
  left join public.posts p on p.id = r.post_id
  where r.user_id = auth.uid() or p.author = auth.uid()
  order by r.created_at desc
  limit 100;
$$;
revoke all on function public.reports_about_me() from public, anon;
grant execute on function public.reports_about_me() to authenticated;
