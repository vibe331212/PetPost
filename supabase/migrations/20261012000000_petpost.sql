-- PetPost online database.
-- Public profile fields, posts, goals and trophies can be seen by anyone signed in;
-- private settings (saved posts, care needs) only by their owner. People can only change their own things.

-- Profiles: one per account. `data` holds the public profile (names, pet details, trophies, streak days...).
create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  username text not null unique check (username ~ '^[a-z0-9_.]{3,20}$'),
  data jsonb not null default '{}',
  created_at timestamptz not null default now()
);

-- Private settings only the owner can see (saved posts, care needs, notification state...).
create table public.private_data (
  id uuid primary key references auth.users on delete cascade,
  data jsonb not null default '{}'
);

create table public.follows (
  follower uuid not null references public.profiles on delete cascade,
  followee uuid not null references public.profiles on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower, followee),
  check (follower <> followee)
);

-- Posts and moments. `data` holds kind, media path and type, caption, goal link and when a moment expires.
create table public.posts (
  id uuid primary key,
  author uuid not null references public.profiles on delete cascade,
  data jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index posts_author on public.posts (author);
create index posts_created on public.posts (created_at desc);

create table public.licks (
  post_id uuid not null references public.posts on delete cascade,
  user_id uuid not null references public.profiles on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create table public.comments (
  id uuid primary key,
  post_id uuid not null references public.posts on delete cascade,
  author uuid not null references public.profiles on delete cascade,
  text text not null check (char_length(text) between 1 and 400),
  created_at timestamptz not null default now()
);
create index comments_post on public.comments (post_id);

create table public.goals (
  id text primary key,
  owner uuid not null references public.profiles on delete cascade,
  data jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index goals_owner on public.goals (owner);

-- Safety: reports go to whoever runs PetPost; blocks hide someone's posts and comments from you.
create table public.reports (
  id bigint generated always as identity primary key,
  reporter uuid not null references public.profiles on delete cascade,
  post_id uuid references public.posts on delete set null,
  user_id uuid references public.profiles on delete set null,
  reason text not null,
  created_at timestamptz not null default now()
);
create table public.blocks (
  blocker uuid not null references public.profiles on delete cascade,
  blocked uuid not null references public.profiles on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker, blocked)
);

alter table public.profiles enable row level security;
alter table public.private_data enable row level security;
alter table public.follows enable row level security;
alter table public.posts enable row level security;
alter table public.licks enable row level security;
alter table public.comments enable row level security;
alter table public.goals enable row level security;
alter table public.reports enable row level security;
alter table public.blocks enable row level security;

create policy "profiles are public to members" on public.profiles for select to authenticated using (true);
create policy "make your own profile" on public.profiles for insert to authenticated with check (id = auth.uid());
create policy "edit your own profile" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

create policy "see your own private data" on public.private_data for select to authenticated using (id = auth.uid());
create policy "save your own private data" on public.private_data for insert to authenticated with check (id = auth.uid());
create policy "update your own private data" on public.private_data for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

create policy "follows are public to members" on public.follows for select to authenticated using (true);
create policy "follow as yourself" on public.follows for insert to authenticated with check (follower = auth.uid());
create policy "unfollow as yourself" on public.follows for delete to authenticated using (follower = auth.uid());

create policy "posts are public to members" on public.posts for select to authenticated using (true);
create policy "post as yourself" on public.posts for insert to authenticated with check (author = auth.uid());
create policy "edit your own posts" on public.posts for update to authenticated using (author = auth.uid()) with check (author = auth.uid());
create policy "delete your own posts" on public.posts for delete to authenticated using (author = auth.uid());

create policy "licks are public to members" on public.licks for select to authenticated using (true);
create policy "lick as yourself" on public.licks for insert to authenticated with check (user_id = auth.uid());
create policy "unlick as yourself" on public.licks for delete to authenticated using (user_id = auth.uid());

create policy "comments are public to members" on public.comments for select to authenticated using (true);
create policy "comment as yourself" on public.comments for insert to authenticated with check (author = auth.uid());
create policy "delete your comments or comments on your posts" on public.comments for delete to authenticated
  using (author = auth.uid() or exists (select 1 from public.posts p where p.id = post_id and p.author = auth.uid()));

create policy "goals are public to members" on public.goals for select to authenticated using (true);
create policy "add your own goals" on public.goals for insert to authenticated with check (owner = auth.uid());
create policy "edit your own goals" on public.goals for update to authenticated using (owner = auth.uid()) with check (owner = auth.uid());
create policy "delete your own goals" on public.goals for delete to authenticated using (owner = auth.uid());

create policy "send a report" on public.reports for insert to authenticated with check (reporter = auth.uid());

create policy "see who you blocked" on public.blocks for select to authenticated using (blocker = auth.uid());
create policy "block as yourself" on public.blocks for insert to authenticated with check (blocker = auth.uid());
create policy "unblock as yourself" on public.blocks for delete to authenticated using (blocker = auth.uid());

-- Deleting your account removes everything you made (the cascades above do the rest).
-- The app deletes your photos and videos from storage first.
create or replace function public.delete_my_account() returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from auth.users where id = auth.uid();
end $$;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

-- Photos and videos: anyone can view a file by its link; people can only add or remove files in their own folder.
insert into storage.buckets (id, name, public, file_size_limit)
values ('media', 'media', true, 314572800)
on conflict (id) do nothing;

create policy "upload to your own folder" on storage.objects for insert to authenticated
  with check (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "replace files in your own folder" on storage.objects for update to authenticated
  using (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "delete files in your own folder" on storage.objects for delete to authenticated
  using (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text);
