create type public.drive_connection_status as enum (
  'disconnected',
  'connecting',
  'connected',
  'syncing',
  'error',
  'revoked'
);

create type public.drive_physical_state as enum (
  'available',
  'missing',
  'reconnecting'
);

create type public.drive_sync_status as enum (
  'pending',
  'processing',
  'retryable',
  'synced',
  'conflict',
  'failed',
  'cancelled'
);

create type public.drive_sync_operation as enum (
  'create_folder',
  'rename_folder',
  'move_folder',
  'upload_file',
  'update_file',
  'copy_file',
  'apply_remote_change',
  'mark_missing',
  'reconnect_file',
  'delete_permanently'
);

create type public.drive_conflict_kind as enum (
  'ambiguous_order',
  'identity_mismatch',
  'remote_deleted_local_changed',
  'local_deleted_remote_changed'
);

create table public.drive_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  status public.drive_connection_status not null default 'disconnected',
  google_subject text check (
    google_subject is null or char_length(google_subject) between 1 and 255
  ),
  google_email text check (
    google_email is null or char_length(google_email) between 3 and 320
  ),
  root_folder_id text check (
    root_folder_id is null or root_folder_id ~ '^[A-Za-z0-9_-]{10,256}$'
  ),
  start_page_token text check (
    start_page_token is null or char_length(start_page_token) between 1 and 4096
  ),
  next_page_token text check (
    next_page_token is null or char_length(next_page_token) between 1 and 4096
  ),
  last_sync_started_at timestamptz,
  last_sync_completed_at timestamptz,
  last_error_code text check (
    last_error_code is null or last_error_code ~ '^[a-z0-9_]{1,64}$'
  ),
  last_error_message text check (
    last_error_message is null or char_length(last_error_message) <= 500
  ),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint drive_connections_connected_fields check (
    status not in ('connected', 'syncing')
    or (google_subject is not null and root_folder_id is not null)
  )
);

create unique index drive_connections_google_subject_unique
  on public.drive_connections (google_subject)
  where google_subject is not null;

alter table public.notebooks
  add column parent_notebook_id uuid,
  add column drive_folder_id text,
  add column drive_modified_time timestamptz,
  add column drive_version text,
  add column drive_sync_status public.drive_sync_status not null default 'pending',
  add column drive_missing boolean not null default false;

alter table public.notebooks
  add constraint notebooks_parent_not_self
    check (parent_notebook_id is null or parent_notebook_id <> id),
  add constraint notebooks_drive_folder_id_format
    check (
      drive_folder_id is null
      or drive_folder_id ~ '^[A-Za-z0-9_-]{10,256}$'
    ),
  add constraint notebooks_drive_version_format
    check (drive_version is null or drive_version ~ '^\d{1,32}$'),
  add constraint notebooks_parent_owner_fk
    foreign key (parent_notebook_id, user_id)
    references public.notebooks(id, user_id)
    on delete restrict;

create unique index notebooks_user_drive_folder_unique
  on public.notebooks (user_id, drive_folder_id)
  where drive_folder_id is not null;

create index notebooks_parent_name_idx
  on public.notebooks (user_id, parent_notebook_id, lower(name));

alter table public.documents
  alter column storage_path drop not null,
  add column drive_file_id text,
  add column drive_parent_folder_id text,
  add column drive_mime_type text,
  add column drive_modified_time timestamptz,
  add column drive_version text,
  add column drive_md5_checksum text,
  add column physical_state public.drive_physical_state not null default 'available',
  add column drive_sync_status public.drive_sync_status not null default 'pending';

alter table public.documents
  add constraint documents_drive_file_id_format
    check (
      drive_file_id is null
      or drive_file_id ~ '^[A-Za-z0-9_-]{10,256}$'
    ),
  add constraint documents_drive_parent_folder_id_format
    check (
      drive_parent_folder_id is null
      or drive_parent_folder_id ~ '^[A-Za-z0-9_-]{10,256}$'
    ),
  add constraint documents_drive_mime_type_format
    check (
      drive_mime_type is null
      or char_length(drive_mime_type) between 1 and 256
    ),
  add constraint documents_drive_version_format
    check (drive_version is null or drive_version ~ '^\d{1,32}$'),
  add constraint documents_drive_md5_format
    check (
      drive_md5_checksum is null
      or drive_md5_checksum ~ '^[0-9a-fA-F]{32}$'
    ),
  add constraint documents_drive_identity_for_nonlegacy check (
    drive_file_id is not null
    or storage_path is not null
  );

comment on column public.documents.storage_path is
  'Temporary processing or explicit fallback object in Supabase Storage. Google Drive is the permanent original store.';

create unique index documents_user_drive_file_unique
  on public.documents (user_id, drive_file_id)
  where drive_file_id is not null;

create index documents_user_physical_state_idx
  on public.documents (user_id, physical_state, updated_at desc);

create table public.drive_sync_jobs (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  operation public.drive_sync_operation not null,
  status public.drive_sync_status not null default 'pending',
  document_id uuid,
  notebook_id uuid,
  drive_file_id text check (
    drive_file_id is null or drive_file_id ~ '^[A-Za-z0-9_-]{10,256}$'
  ),
  idempotency_key text not null check (
    char_length(idempotency_key) between 16 and 240
    and idempotency_key !~ '[[:cntrl:]]'
  ),
  payload jsonb not null default '{}'::jsonb
    check (jsonb_typeof(payload) = 'object'),
  attempt_count integer not null default 0 check (attempt_count between 0 and 50),
  next_retry_at timestamptz,
  lease_owner text check (
    lease_owner is null or char_length(lease_owner) between 1 and 160
  ),
  lease_expires_at timestamptz,
  last_error_code text check (
    last_error_code is null or last_error_code ~ '^[a-z0-9_]{1,64}$'
  ),
  last_error_message text check (
    last_error_message is null or char_length(last_error_message) <= 500
  ),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  finished_at timestamptz,
  unique (id, user_id),
  unique (user_id, idempotency_key),
  foreign key (document_id, user_id)
    references public.documents(id, user_id)
    on delete cascade,
  foreign key (notebook_id, user_id)
    references public.notebooks(id, user_id)
    on delete cascade,
  constraint drive_sync_jobs_target_present check (
    document_id is not null
    or notebook_id is not null
    or drive_file_id is not null
  ),
  constraint drive_sync_jobs_lease_pair check (
    (lease_owner is null and lease_expires_at is null)
    or (lease_owner is not null and lease_expires_at is not null)
  )
);

create index drive_sync_jobs_runnable_idx
  on public.drive_sync_jobs (user_id, status, next_retry_at, created_at)
  where status in ('pending', 'retryable');

create index drive_sync_jobs_document_idx
  on public.drive_sync_jobs (document_id, created_at desc)
  where document_id is not null;

create table public.drive_conflicts (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  job_id uuid not null,
  document_id uuid,
  notebook_id uuid,
  kind public.drive_conflict_kind not null,
  local_snapshot jsonb not null default '{}'::jsonb
    check (jsonb_typeof(local_snapshot) = 'object'),
  remote_snapshot jsonb not null default '{}'::jsonb
    check (jsonb_typeof(remote_snapshot) = 'object'),
  resolution text check (
    resolution is null
    or (
      char_length(resolution) between 1 and 64
      and resolution ~ '^[a-z0-9_]+$'
    )
  ),
  resolved_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (id, user_id),
  foreign key (job_id, user_id)
    references public.drive_sync_jobs(id, user_id)
    on delete cascade,
  foreign key (document_id, user_id)
    references public.documents(id, user_id)
    on delete cascade,
  foreign key (notebook_id, user_id)
    references public.notebooks(id, user_id)
    on delete cascade,
  constraint drive_conflicts_target_present check (
    document_id is not null or notebook_id is not null
  ),
  constraint drive_conflicts_resolution_pair check (
    (resolution is null and resolved_at is null)
    or (resolution is not null and resolved_at is not null)
  )
);

create unique index drive_conflicts_one_open_per_job
  on public.drive_conflicts (job_id)
  where resolved_at is null;

create index drive_conflicts_user_open_idx
  on public.drive_conflicts (user_id, created_at desc)
  where resolved_at is null;

create trigger drive_connections_set_updated_at
before update on public.drive_connections
for each row execute function public.set_updated_at();

create trigger drive_sync_jobs_set_updated_at
before update on public.drive_sync_jobs
for each row execute function public.set_updated_at();

create trigger drive_conflicts_set_updated_at
before update on public.drive_conflicts
for each row execute function public.set_updated_at();

alter table public.drive_connections enable row level security;
alter table public.drive_connections force row level security;
alter table public.drive_sync_jobs enable row level security;
alter table public.drive_sync_jobs force row level security;
alter table public.drive_conflicts enable row level security;
alter table public.drive_conflicts force row level security;

create policy drive_connections_owner_all
on public.drive_connections
for all
to authenticated
using (
  (select auth.uid()) = user_id
  and (select public.is_authorized_user())
)
with check (
  (select auth.uid()) = user_id
  and (select public.is_authorized_user())
);

create policy drive_sync_jobs_owner_all
on public.drive_sync_jobs
for all
to authenticated
using (
  (select auth.uid()) = user_id
  and (select public.is_authorized_user())
)
with check (
  (select auth.uid()) = user_id
  and (select public.is_authorized_user())
);

create policy drive_conflicts_owner_all
on public.drive_conflicts
for all
to authenticated
using (
  (select auth.uid()) = user_id
  and (select public.is_authorized_user())
)
with check (
  (select auth.uid()) = user_id
  and (select public.is_authorized_user())
);

revoke all on table public.drive_connections from anon;
revoke all on table public.drive_sync_jobs from anon;
revoke all on table public.drive_conflicts from anon;

grant select, insert, update, delete on table public.drive_connections to authenticated;
grant select, insert, update, delete on table public.drive_sync_jobs to authenticated;
grant select, insert, update, delete on table public.drive_conflicts to authenticated;

create or replace function public.mark_drive_file_missing(target_drive_file_id text)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  result_id uuid;
begin
  if not public.is_authorized_user() then
    raise insufficient_privilege using message = 'Drive access is not authorized';
  end if;

  if target_drive_file_id is null
    or target_drive_file_id !~ '^[A-Za-z0-9_-]{10,256}$'
  then
    raise invalid_parameter_value using message = 'Invalid Drive file identifier';
  end if;

  update public.documents as document
  set
    physical_state = 'missing',
    drive_sync_status = 'synced'
  where document.user_id = auth.uid()
    and document.drive_file_id = target_drive_file_id
  returning document.id into result_id;

  if result_id is null then
    select document.id
    into result_id
    from public.documents as document
    where document.user_id = auth.uid()
      and document.drive_file_id = target_drive_file_id;
  end if;

  return result_id;
end;
$$;

create or replace function public.reconnect_drive_file(
  target_document_id uuid,
  target_drive_file_id text,
  target_modified_time timestamptz,
  target_version text
)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  changed boolean;
begin
  if not public.is_authorized_user() then
    raise insufficient_privilege using message = 'Drive access is not authorized';
  end if;

  if target_drive_file_id is null
    or target_drive_file_id !~ '^[A-Za-z0-9_-]{10,256}$'
    or target_version is null
    or target_version !~ '^\d{1,32}$'
  then
    raise invalid_parameter_value using message = 'Invalid Drive reconnection input';
  end if;

  update public.documents as document
  set
    physical_state = 'available',
    drive_modified_time = target_modified_time,
    drive_version = target_version,
    drive_sync_status = 'synced'
  where document.id = target_document_id
    and document.user_id = auth.uid()
    and document.drive_file_id = target_drive_file_id;

  get diagnostics changed = row_count;
  return changed;
end;
$$;

create or replace function public.claim_drive_sync_job(
  worker_id text,
  lease_seconds integer default 60
)
returns table (
  id uuid,
  operation public.drive_sync_operation,
  document_id uuid,
  notebook_id uuid,
  drive_file_id text,
  payload jsonb,
  attempt_count integer,
  lease_expires_at timestamptz
)
language plpgsql
set search_path = ''
as $$
begin
  if not public.is_authorized_user() then
    raise insufficient_privilege using message = 'Drive access is not authorized';
  end if;

  if worker_id is null
    or char_length(worker_id) not between 1 and 160
    or lease_seconds not between 15 and 900
  then
    raise invalid_parameter_value using message = 'Invalid Drive worker lease';
  end if;

  return query
  with candidate as (
    select job.id
    from public.drive_sync_jobs as job
    where job.user_id = auth.uid()
      and job.status in ('pending', 'retryable')
      and (job.next_retry_at is null or job.next_retry_at <= timezone('utc', now()))
      and (job.lease_expires_at is null or job.lease_expires_at <= timezone('utc', now()))
    order by job.created_at, job.id
    for update skip locked
    limit 1
  )
  update public.drive_sync_jobs as job
  set
    status = 'processing',
    lease_owner = worker_id,
    lease_expires_at = timezone('utc', now()) + make_interval(secs => lease_seconds),
    attempt_count = job.attempt_count + 1,
    last_error_code = null,
    last_error_message = null
  from candidate
  where job.id = candidate.id
  returning
    job.id,
    job.operation,
    job.document_id,
    job.notebook_id,
    job.drive_file_id,
    job.payload,
    job.attempt_count,
    job.lease_expires_at;
end;
$$;

revoke all on function public.mark_drive_file_missing(text) from public, anon;
revoke all on function public.reconnect_drive_file(uuid, text, timestamptz, text) from public, anon;
revoke all on function public.claim_drive_sync_job(text, integer) from public, anon;

grant execute on function public.mark_drive_file_missing(text) to authenticated;
grant execute on function public.reconnect_drive_file(uuid, text, timestamptz, text) to authenticated;
grant execute on function public.claim_drive_sync_job(text, integer) to authenticated;
