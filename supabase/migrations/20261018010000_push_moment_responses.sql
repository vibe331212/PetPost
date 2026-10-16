-- Phone notifications for votes, answers and reactions on your moments, too.
create trigger push_on_moment_response after insert on public.moment_responses for each row execute function public.push_notify();
