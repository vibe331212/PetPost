-- Feedback: bugs, ideas and anything else people want to tell the PetPost team. Anyone signed in can
-- send it; only admins can read or clear it. A screenshot, if added, is a file in the sender's own folder.
create table public.feedback (
  id bigint generated always as identity primary key,
  user_id uuid references public.profiles on delete set null,
  kind text not null check (kind in ('bug', 'idea', 'other')),
  message text not null check (char_length(message) between 1 and 2000),
  screenshot_path text,
  details jsonb not null default '{}', -- the page they were on, their phone or browser, and the app version
  created_at timestamptz not null default now()
);
alter table public.feedback enable row level security;

create policy "send feedback as yourself" on public.feedback for insert to authenticated with check (user_id = auth.uid());
create policy "admins can read feedback" on public.feedback for select to authenticated using (public.is_admin());
create policy "admins can clear feedback" on public.feedback for delete to authenticated using (public.is_admin());

-- Admins get a phone notification when new feedback comes in (the push function sends it to every admin).
create trigger push_on_feedback after insert on public.feedback for each row execute function public.push_notify();
