-- Polls, quizzes, question boxes and rating sliders on normal posts, not just moments.
-- They use the same responses table: a quiz guess is a 'vote', and a rating (1 to 10) is a 'rating'.
alter table public.moment_responses drop constraint if exists moment_responses_kind_check;
alter table public.moment_responses add constraint moment_responses_kind_check
  check (kind in ('vote', 'answer', 'reaction', 'rating'));

-- Respond to any post you can see (before, only moments).
drop policy if exists "respond to moments you can see" on public.moment_responses;
create policy "respond to posts you can see" on public.moment_responses for insert to authenticated
  with check (user_id = auth.uid() and exists (select 1 from public.posts p where p.id = post_id));

-- Totals for many posts at once, without saying who responded (only the post's owner sees that):
-- one row per poll or quiz choice with its votes, and one row per rated post with the average.
create or replace function public.post_results(targets uuid[])
returns table (post_id uuid, choice text, votes bigint, average numeric)
language sql stable security definer set search_path = public as $$
  select r.post_id,
         case when r.kind = 'vote' then r.value end,
         count(*),
         avg(case when r.kind = 'rating' then r.value::numeric end)
  from public.moment_responses r
  join public.posts p on p.id = r.post_id
  where r.post_id = any(targets) and r.kind in ('vote', 'rating')
    and not exists (
      select 1 from public.blocks b
      where (b.blocker = auth.uid() and b.blocked = p.author) or (b.blocker = p.author and b.blocked = auth.uid())
    )
  group by r.post_id, r.kind, case when r.kind = 'vote' then r.value end;
$$;
revoke all on function public.post_results(uuid[]) from public, anon;
grant execute on function public.post_results(uuid[]) to authenticated;

notify pgrst, 'reload schema';
