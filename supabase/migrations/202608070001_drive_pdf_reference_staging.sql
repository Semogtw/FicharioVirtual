create table public.drive_pdf_reference_imports (
  document_id uuid primary key,
  user_id uuid not null,
  source_size_bytes bigint not null check (
    source_size_bytes between 1 and 9007199254740991
  ),
  source_modified_at timestamptz not null,
  status text not null default 'pending_inspection' check (
    status in ('pending_inspection', 'inspecting', 'ready_to_finalize', 'failed')
  ),
  last_error_code text check (
    last_error_code is null or last_error_code ~ '^[a-z0-9_]{1,64}$'
  ),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (document_id, user_id),
  foreign key (document_id, user_id)
    references public.documents(id, user_id)
    on delete cascade
);

create index drive_pdf_reference_imports_user_status_idx
  on public.drive_pdf_reference_imports (user_id, status, updated_at desc);

create trigger drive_pdf_reference_imports_set_updated_at
before update on public.drive_pdf_reference_imports
for each row execute function public.set_updated_at();

alter table public.drive_pdf_reference_imports enable row level security;
alter table public.drive_pdf_reference_imports force row level security;

create policy drive_pdf_reference_imports_owner_all
on public.drive_pdf_reference_imports
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

revoke all on table public.drive_pdf_reference_imports from anon;
revoke all on table public.drive_pdf_reference_imports from authenticated;
grant select, insert, update, delete on table public.drive_pdf_reference_imports to authenticated;

create or replace function public.stage_drive_pdf_reference(
  target_document_id uuid,
  target_notebook_id uuid,
  document_title text,
  original_filename text,
  target_drive_file_id text,
  target_drive_parent_folder_id text,
  target_drive_modified_time timestamptz,
  target_drive_version text,
  target_drive_md5_checksum text,
  source_size_bytes bigint,
  source_modified_at timestamptz
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  expected_parent_folder_id text;
begin
  if current_user_id is null or not (select public.is_authorized_user()) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  if target_document_id is null
    or char_length(trim(document_title)) not between 1 and 240
    or char_length(original_filename) not between 1 and 512
    or char_length(target_drive_file_id) not between 10 and 256
    or target_drive_file_id !~ '^[A-Za-z0-9_-]+$'
    or char_length(target_drive_parent_folder_id) not between 10 and 256
    or target_drive_parent_folder_id !~ '^[A-Za-z0-9_-]+$'
    or target_drive_modified_time is null
    or target_drive_version !~ '^\d{1,32}$'
    or (
      target_drive_md5_checksum is not null
      and target_drive_md5_checksum !~ '^[0-9a-fA-F]{32}$'
    )
    or source_size_bytes not between 1 and 9007199254740991
    or source_modified_at is null
  then
    raise exception 'invalid Drive PDF reference metadata' using errcode = '22023';
  end if;

  if target_notebook_id is null then
    select connection.root_folder_id
    into expected_parent_folder_id
    from public.drive_connections as connection
    where connection.user_id = current_user_id
      and connection.status in ('connected', 'syncing');
  else
    select notebook.drive_folder_id
    into expected_parent_folder_id
    from public.notebooks as notebook
    where notebook.id = target_notebook_id
      and notebook.user_id = current_user_id
      and not notebook.drive_missing;
  end if;

  if expected_parent_folder_id is null
    or expected_parent_folder_id <> target_drive_parent_folder_id
  then
    raise exception 'invalid Drive parent folder' using errcode = '42501';
  end if;

  insert into public.documents (
    id,
    user_id,
    notebook_id,
    title,
    kind,
    original_filename,
    storage_path,
    page_count,
    status,
    sha256,
    source_created_at,
    drive_file_id,
    drive_parent_folder_id,
    drive_mime_type,
    drive_modified_time,
    drive_version,
    drive_md5_checksum,
    physical_state,
    drive_sync_status
  ) values (
    target_document_id,
    current_user_id,
    target_notebook_id,
    trim(document_title),
    'pdf',
    original_filename,
    null,
    0,
    'uploading',
    null,
    source_modified_at,
    target_drive_file_id,
    target_drive_parent_folder_id,
    'application/pdf',
    target_drive_modified_time,
    target_drive_version,
    lower(target_drive_md5_checksum),
    'available',
    'synced'
  );

  insert into public.drive_pdf_reference_imports (
    document_id,
    user_id,
    source_size_bytes,
    source_modified_at,
    status,
    last_error_code
  ) values (
    target_document_id,
    current_user_id,
    source_size_bytes,
    source_modified_at,
    'pending_inspection',
    null
  );

  return jsonb_build_object(
    'documentId', target_document_id,
    'driveFileId', target_drive_file_id,
    'sourceSizeBytes', source_size_bytes,
    'status', 'pending_inspection'
  );
end;
$$;

revoke execute on function public.stage_drive_pdf_reference(
  uuid, uuid, text, text, text, text, timestamptz, text, text, bigint, timestamptz
) from public, anon;
grant execute on function public.stage_drive_pdf_reference(
  uuid, uuid, text, text, text, text, timestamptz, text, text, bigint, timestamptz
) to authenticated;
