create index notebooks_parent_owner_idx
  on public.notebooks (parent_notebook_id, user_id)
  where parent_notebook_id is not null;

create index drive_sync_jobs_document_owner_idx
  on public.drive_sync_jobs (document_id, user_id)
  where document_id is not null;

create index drive_sync_jobs_notebook_owner_idx
  on public.drive_sync_jobs (notebook_id, user_id)
  where notebook_id is not null;

create index drive_conflicts_job_owner_idx
  on public.drive_conflicts (job_id, user_id);

create index drive_conflicts_document_owner_idx
  on public.drive_conflicts (document_id, user_id)
  where document_id is not null;

create index drive_conflicts_notebook_owner_idx
  on public.drive_conflicts (notebook_id, user_id)
  where notebook_id is not null;
