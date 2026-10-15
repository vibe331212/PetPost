-- Blocking works both ways. If either person blocked the other, neither sees the other's posts,
-- comments, licks or goals, and neither can lick or comment on the other's posts or follow them.
-- The person who was blocked can't see the blocker's profile at all. The blocker can still open the
-- blocked person's profile, so they can unblock them later.

-- True if you blocked this person, or they blocked you. It only ever answers about you,
-- so nobody can use it to find out who else has blocked whom.
create or replace function public.blocked_with_me(other uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.blocks
    where (blocker = auth.uid() and blocked = other) or (blocker = other and blocked = auth.uid())
  );
$$;
revoke all on function public.blocked_with_me(uuid) from public, anon;
grant execute on function public.blocked_with_me(uuid) to authenticated;

-- True if this person blocked you.
create or replace function public.blocked_me(other uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.blocks where blocker = other and blocked = auth.uid());
$$;
revoke all on function public.blocked_me(uuid) from public, anon;
grant execute on function public.blocked_me(uuid) to authenticated;

drop policy "profiles are public to members" on public.profiles;
create policy "profiles are public to members, except to people they blocked" on public.profiles for select to authenticated
  using (not public.blocked_me(id));

drop policy "posts are public to members" on public.posts;
create policy "posts are public to members, except between blocked people" on public.posts for select to authenticated
  using (not public.blocked_with_me(author));

-- Licks and comments on a post you can't see are hidden too (the posts rule above applies inside these checks).
drop policy "licks are public to members" on public.licks;
create policy "licks are public to members, except between blocked people" on public.licks for select to authenticated
  using (not public.blocked_with_me(user_id) and exists (select 1 from public.posts p where p.id = post_id));
drop policy "lick as yourself" on public.licks;
create policy "lick as yourself, on posts you can see" on public.licks for insert to authenticated
  with check (user_id = auth.uid() and exists (select 1 from public.posts p where p.id = post_id));

drop policy "comments are public to members" on public.comments;
create policy "comments are public to members, except between blocked people" on public.comments for select to authenticated
  using (not public.blocked_with_me(author) and exists (select 1 from public.posts p where p.id = post_id));
drop policy "comment as yourself" on public.comments;
create policy "comment as yourself, on posts you can see" on public.comments for insert to authenticated
  with check (author = auth.uid() and exists (select 1 from public.posts p where p.id = post_id));

drop policy "goals are public to members" on public.goals;
create policy "goals are public to members, except between blocked people" on public.goals for select to authenticated
  using (not public.blocked_with_me(owner));

drop policy "follow as yourself" on public.follows;
create policy "follow as yourself, unless one of you blocked the other" on public.follows for insert to authenticated
  with check (follower = auth.uid() and not public.blocked_with_me(followee));

-- Blocking someone stops both of you following each other.
create or replace function public.unfollow_on_block() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from public.follows
  where (follower = new.blocker and followee = new.blocked) or (follower = new.blocked and followee = new.blocker);
  return new;
end $$;
revoke all on function public.unfollow_on_block() from public, anon, authenticated;
create trigger unfollow_on_block after insert on public.blocks
  for each row execute function public.unfollow_on_block();
