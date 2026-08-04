alter table public.import_sessions
  add constraint import_sessions_user_resume_key_unique
  unique (user_id, local_resume_key);
