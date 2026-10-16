-- Answers to moments: poll votes, answers to a question, and quick reactions.
-- One of each per person per moment (voting again or picking another reaction replaces it).
create table public.moment_responses (
  post_id uuid not null references public.posts on delete cascade,
  user_id uuid not null references public.profiles on delete cascade,
  kind text not null check (kind in ('vote', 'answer', 'reaction')),
  value text not null check (char_length(value) between 1 and 300),
  created_at timestamptz not null default now(),
  primary key (post_id, user_id, kind)
);
create index moment_responses_post on public.moment_responses (post_id);
alter table public.moment_responses enable row level security;

-- You see your own responses, and every response to your own moments (so you know who voted, answered or reacted).
create policy "see your responses and responses to your moments" on public.moment_responses for select to authenticated
  using (user_id = auth.uid() or exists (select 1 from public.posts p where p.id = post_id and p.author = auth.uid()));
-- You can respond to moments you can see (the posts rules, including blocking, apply inside this check).
create policy "respond to moments you can see" on public.moment_responses for insert to authenticated
  with check (user_id = auth.uid() and exists (select 1 from public.posts p where p.id = post_id and p.data->>'kind' = 'moment'));
create policy "change your response" on public.moment_responses for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "take back your response" on public.moment_responses for delete to authenticated
  using (user_id = auth.uid());

-- How many votes each poll choice has, without saying who voted (only the moment's owner sees that).
create or replace function public.moment_poll_results(target uuid)
returns table (choice text, votes bigint)
language sql stable security definer set search_path = public as $$
  select r.value, count(*)
  from public.moment_responses r
  join public.posts p on p.id = r.post_id
  where r.post_id = target and r.kind = 'vote'
    and not exists (
      select 1 from public.blocks b
      where (b.blocker = auth.uid() and b.blocked = p.author) or (b.blocker = p.author and b.blocked = auth.uid())
    )
  group by r.value;
$$;
revoke all on function public.moment_poll_results(uuid) from public, anon;
grant execute on function public.moment_poll_results(uuid) to authenticated;
