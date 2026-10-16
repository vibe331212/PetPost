-- Dismissing reports did nothing: the database only deletes rows the person can read, and reports
-- can't be read directly (admins see them through admin_reports). Dismiss through a function instead,
-- the same way admin_delete_post works. Returns how many reports were dismissed.
drop policy if exists "admins can dismiss reports" on public.reports;

create or replace function public.admin_dismiss_reports(ids bigint[]) returns integer
language plpgsql security definer set search_path = public as $$
declare dismissed integer;
begin
  if not public.is_admin() then raise exception 'Only admins can dismiss reports'; end if;
  delete from public.reports where id = any(ids);
  get diagnostics dismissed = row_count;
  return dismissed;
end $$;
revoke all on function public.admin_dismiss_reports(bigint[]) from public, anon;
grant execute on function public.admin_dismiss_reports(bigint[]) to authenticated;
