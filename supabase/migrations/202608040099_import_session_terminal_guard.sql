create or replace function public.guard_import_session_progress()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status in ('completed', 'cancelled') then
    if new.status <> old.status
      or new.total_items <> old.total_items
      or new.prepared_items <> old.prepared_items
      or new.uploaded_items <> old.uploaded_items
      or new.completed_items <> old.completed_items then
      raise exception 'terminal import session cannot regress'
        using errcode = '23514';
    end if;

    new.finished_at := old.finished_at;
    new.last_error_code := old.last_error_code;
    return new;
  end if;

  if new.total_items < old.total_items
    or new.prepared_items < old.prepared_items
    or new.uploaded_items < old.uploaded_items
    or new.completed_items < old.completed_items then
    raise exception 'import session progress cannot regress'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists import_sessions_guard_progress on public.import_sessions;
create trigger import_sessions_guard_progress
before update on public.import_sessions
for each row execute function public.guard_import_session_progress();
