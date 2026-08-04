alter table public.import_sessions
  add constraint import_sessions_monotonic_progress_check
  check (
    prepared_items >= uploaded_items
    and uploaded_items >= completed_items
  ),
  add constraint import_sessions_terminal_timestamp_check
  check (
    (status in ('completed', 'cancelled') and finished_at is not null)
    or (status not in ('completed', 'cancelled') and finished_at is null)
  ),
  add constraint import_sessions_resume_key_content_check
  check (
    local_resume_key is null
    or local_resume_key !~ '[[:cntrl:]]'
  );
