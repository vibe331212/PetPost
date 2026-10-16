-- Licks and comments on trophies. Trophies live inside each profile, so they're named by their owner
-- and the trophy's id (record trophies use ids like 'record-licks').
create table public.trophy_reactions (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references public.profiles on delete cascade,
  trophy_id text not null check (char_length(trophy_id) between 1 and 80),
  user_id uuid not null references public.profiles on delete cascade,
  kind text not null check (kind in ('lick', 'comment')),
  text text check (kind = 'lick' or char_length(text) between 1 and 400),
  created_at timestamptz not null default now()
);
create index trophy_reactions_owner on public.trophy_reactions (owner);
-- One lick per person per trophy.
create unique index trophy_reactions_one_lick on public.trophy_reactions (owner, trophy_id, user_id) where kind = 'lick';
alter table public.trophy_reactions enable row level security;

create policy "trophy licks and comments are public to members, except between blocked people" on public.trophy_reactions
  for select to authenticated using (not public.blocked_with_me(user_id) and not public.blocked_with_me(owner));
create policy "lick or comment on trophies as yourself" on public.trophy_reactions
  for insert to authenticated with check (user_id = auth.uid() and not public.blocked_with_me(owner));
create policy "take back your lick or comment, or remove comments on your trophies" on public.trophy_reactions
  for delete to authenticated using (user_id = auth.uid() or owner = auth.uid());

-- Phone notifications for these too.
create trigger push_on_trophy_reaction after insert on public.trophy_reactions for each row execute function public.push_notify();
