alter table public.drive_pdf_reference_imports
  add column descriptor_attempt_id uuid,
  add column descriptor_expected_page_count integer,
  add column descriptor_attempt_expires_at timestamptz;

alter table public.drive_pdf_reference_imports
  add constraint drive_pdf_reference_descriptor_attempt_shape check (
    (
      descriptor_attempt_id is null
      and descriptor_expected_page_count is null
      and descriptor_attempt_expires_at is null
    )
    or (
      descriptor_attempt_id is not null
      and descriptor_expected_page_count between 1 and 10000
      and descriptor_attempt_expires_at is not null
      and descriptor_attempt_expires_at > timezone('utc', timestamp '2000-01-01')
    )
  );

create table public.drive_pdf_reference_page_staging (
  document_id uuid not null,
  user_id uuid not null,
  page_number integer not null check (page_number between 1 and 10000),
  attempt_id uuid not null,
  descriptor jsonb not null,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (document_id, page_number),
  foreign key (document_id, user_id)
    references public.drive_pdf_reference_imports(document_id, user_id)
    on delete cascade
);

create index drive_pdf_reference_page_staging_attempt_idx
  on public.drive_pdf_reference_page_staging (document_id, attempt_id, page_number);

alter table public.drive_pdf_reference_page_staging enable row level security;

revoke all on table public.drive_pdf_reference_page_staging from public, anon, authenticated;
grant all on table public.drive_pdf_reference_page_staging to service_role;

create or replace function public.begin_drive_pdf_reference_descriptor_attempt(
  target_document_id uuid,
  target_attempt_id uuid,
  expected_page_count integer
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_user_id uuid := auth.uid();
  reference_row public.drive_pdf_reference_imports%rowtype;
  lease_until timestamptz := timezone('utc', now()) + interval '15 minutes';
begin
  if current_user_id is null or not public.is_authorized_user() then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;

  if target_document_id is null
    or target_attempt_id is null
    or expected_page_count is null
    or expected_page_count < 1
    or expected_page_count > 10000 then
    raise exception using errcode = '22023', message = 'Invalid Drive PDF descriptor attempt';
  end if;

  select reference.*
    into reference_row
    from public.drive_pdf_reference_imports as reference
    join public.documents as document
      on document.id = reference.document_id
     and document.user_id = reference.user_id
   where reference.document_id = target_document_id
     and reference.user_id = current_user_id
     and reference.status = 'pending_inspection'
     and document.kind = 'pdf'
     and document.status = 'uploading'
     and document.page_count = 0
     and document.storage_path is null
     and document.sha256 is null
   for update of reference;

  if not found then
    raise exception using errcode = '55000', message = 'Drive PDF reference is unavailable for descriptor staging';
  end if;

  if reference_row.descriptor_attempt_id = target_attempt_id then
    if reference_row.descriptor_expected_page_count <> expected_page_count then
      raise exception using errcode = '22023', message = 'Drive PDF descriptor attempt page count mismatch';
    end if;

    update public.drive_pdf_reference_imports
       set descriptor_attempt_expires_at = lease_until,
           updated_at = timezone('utc', now())
     where document_id = target_document_id
       and user_id = current_user_id
       and descriptor_attempt_id = target_attempt_id;

    return jsonb_build_object(
      'documentId', target_document_id,
      'attemptId', target_attempt_id,
      'expectedPageCount', expected_page_count,
      'expiresAt', lease_until
    );
  end if;

  if reference_row.descriptor_attempt_id is not null
    and reference_row.descriptor_attempt_expires_at is not null
    and reference_row.descriptor_attempt_expires_at > timezone('utc', now()) then
    raise exception using errcode = '55P03', message = 'Another Drive PDF descriptor attempt is active';
  end if;

  delete from public.drive_pdf_reference_page_staging
   where document_id = target_document_id
     and user_id = current_user_id;

  update public.drive_pdf_reference_imports
     set descriptor_attempt_id = target_attempt_id,
         descriptor_expected_page_count = expected_page_count,
         descriptor_attempt_expires_at = lease_until,
         updated_at = timezone('utc', now())
   where document_id = target_document_id
     and user_id = current_user_id;

  return jsonb_build_object(
    'documentId', target_document_id,
    'attemptId', target_attempt_id,
    'expectedPageCount', expected_page_count,
    'expiresAt', lease_until
  );
end;
$$;

create or replace function public.renew_drive_pdf_reference_descriptor_attempt(
  target_document_id uuid,
  target_attempt_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_user_id uuid := auth.uid();
  expected_page_count integer;
  current_expiry timestamptz;
  lease_until timestamptz := timezone('utc', now()) + interval '15 minutes';
begin
  if current_user_id is null or not public.is_authorized_user() then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;

  if target_document_id is null or target_attempt_id is null then
    raise exception using errcode = '22023', message = 'Invalid Drive PDF descriptor attempt';
  end if;

  select descriptor_expected_page_count, descriptor_attempt_expires_at
    into expected_page_count, current_expiry
    from public.drive_pdf_reference_imports
   where document_id = target_document_id
     and user_id = current_user_id
     and status = 'pending_inspection'
     and descriptor_attempt_id = target_attempt_id
   for update;

  if not found
    or expected_page_count is null
    or current_expiry is null
    or current_expiry <= timezone('utc', now()) then
    raise exception using errcode = '55P03', message = 'Drive PDF descriptor attempt lease is not active';
  end if;

  update public.drive_pdf_reference_imports
     set descriptor_attempt_expires_at = lease_until,
         updated_at = timezone('utc', now())
   where document_id = target_document_id
     and user_id = current_user_id
     and descriptor_attempt_id = target_attempt_id;

  return jsonb_build_object(
    'documentId', target_document_id,
    'attemptId', target_attempt_id,
    'expectedPageCount', expected_page_count,
    'expiresAt', lease_until
  );
end;
$$;

create or replace function public.stage_drive_pdf_reference_descriptor_batch(
  target_document_id uuid,
  target_attempt_id uuid,
  descriptors jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_user_id uuid := auth.uid();
  expected_page_count integer;
  current_expiry timestamptz;
  lease_until timestamptz := timezone('utc', now()) + interval '15 minutes';
  descriptor_value jsonb;
  page_number_text text;
  parsed_page_number integer;
  inserted_count integer;
  accepted_count integer := 0;
  existing_attempt_id uuid;
  existing_descriptor jsonb;
begin
  if current_user_id is null or not public.is_authorized_user() then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;

  if target_document_id is null or target_attempt_id is null then
    raise exception using errcode = '22023', message = 'Invalid Drive PDF descriptor attempt';
  end if;

  if descriptors is null
    or jsonb_typeof(descriptors) <> 'array'
    or jsonb_array_length(descriptors) < 1
    or jsonb_array_length(descriptors) > 100
    or pg_column_size(descriptors) > 4194304 then
    raise exception using errcode = '22023', message = 'Invalid Drive PDF descriptor batch';
  end if;

  select descriptor_expected_page_count, descriptor_attempt_expires_at
    into expected_page_count, current_expiry
    from public.drive_pdf_reference_imports
   where document_id = target_document_id
     and user_id = current_user_id
     and status = 'pending_inspection'
     and descriptor_attempt_id = target_attempt_id
   for update;

  if not found
    or expected_page_count is null
    or current_expiry is null
    or current_expiry <= timezone('utc', now()) then
    raise exception using errcode = '55P03', message = 'Drive PDF descriptor attempt lease is not active';
  end if;

  for descriptor_value in select value from jsonb_array_elements(descriptors)
  loop
    if jsonb_typeof(descriptor_value) <> 'object'
      or jsonb_typeof(descriptor_value -> 'pageNumber') <> 'number' then
      raise exception using errcode = '22023', message = 'Invalid Drive PDF page descriptor';
    end if;

    page_number_text := descriptor_value ->> 'pageNumber';
    if page_number_text is null or page_number_text !~ '^[0-9]{1,5}$' then
      raise exception using errcode = '22023', message = 'Invalid Drive PDF page number';
    end if;

    parsed_page_number := page_number_text::integer;
    if parsed_page_number < 1 or parsed_page_number > expected_page_count then
      raise exception using errcode = '22023', message = 'Invalid Drive PDF page number';
    end if;

    insert into public.drive_pdf_reference_page_staging (
      document_id,
      user_id,
      page_number,
      attempt_id,
      descriptor
    ) values (
      target_document_id,
      current_user_id,
      parsed_page_number,
      target_attempt_id,
      descriptor_value
    )
    on conflict (document_id, page_number) do nothing;
    get diagnostics inserted_count = row_count;

    if inserted_count = 0 then
      select staging.attempt_id, staging.descriptor
        into existing_attempt_id, existing_descriptor
        from public.drive_pdf_reference_page_staging as staging
       where staging.document_id = target_document_id
         and staging.page_number = parsed_page_number
         and staging.user_id = current_user_id;

      if not found
        or existing_attempt_id is distinct from target_attempt_id
        or existing_descriptor is distinct from descriptor_value then
        raise exception using errcode = '22023', message = 'Drive PDF page descriptor retry mismatch';
      end if;
    end if;

    accepted_count := accepted_count + 1;
  end loop;

  update public.drive_pdf_reference_imports
     set descriptor_attempt_expires_at = lease_until,
         updated_at = timezone('utc', now())
   where document_id = target_document_id
     and user_id = current_user_id
     and descriptor_attempt_id = target_attempt_id;

  return jsonb_build_object(
    'documentId', target_document_id,
    'attemptId', target_attempt_id,
    'acceptedCount', accepted_count,
    'expiresAt', lease_until
  );
end;
$$;

create or replace function public.finalize_drive_pdf_reference_descriptor_attempt(
  target_document_id uuid,
  target_attempt_id uuid,
  prompt_version integer default 1
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_user_id uuid := auth.uid();
  expected_page_count integer;
  current_expiry timestamptz;
  staged_count integer;
  minimum_page integer;
  maximum_page integer;
  staged_descriptors jsonb;
  publication jsonb;
begin
  if current_user_id is null or not public.is_authorized_user() then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;

  if target_document_id is null
    or target_attempt_id is null
    or prompt_version is null
    or prompt_version < 1
    or prompt_version > 10000 then
    raise exception using errcode = '22023', message = 'Invalid Drive PDF descriptor finalization request';
  end if;

  select descriptor_expected_page_count, descriptor_attempt_expires_at
    into expected_page_count, current_expiry
    from public.drive_pdf_reference_imports
   where document_id = target_document_id
     and user_id = current_user_id
     and status = 'pending_inspection'
     and descriptor_attempt_id = target_attempt_id
   for update;

  if not found
    or expected_page_count is null
    or current_expiry is null
    or current_expiry <= timezone('utc', now()) then
    raise exception using errcode = '55P03', message = 'Drive PDF descriptor attempt lease is not active';
  end if;

  select count(*)::integer, min(page_number), max(page_number)
    into staged_count, minimum_page, maximum_page
    from public.drive_pdf_reference_page_staging
   where document_id = target_document_id
     and user_id = current_user_id
     and attempt_id = target_attempt_id;

  if staged_count <> expected_page_count
    or minimum_page <> 1
    or maximum_page <> expected_page_count then
    raise exception using errcode = '22023', message = 'Drive PDF staged descriptors are incomplete';
  end if;

  select jsonb_agg(descriptor order by page_number)
    into staged_descriptors
    from public.drive_pdf_reference_page_staging
   where document_id = target_document_id
     and user_id = current_user_id
     and attempt_id = target_attempt_id;

  if staged_descriptors is null
    or jsonb_array_length(staged_descriptors) <> expected_page_count then
    raise exception using errcode = '22023', message = 'Drive PDF staged descriptors are incomplete';
  end if;

  select result
    into publication
    from public.finalize_drive_pdf_reference_import(
      target_document_id,
      staged_descriptors,
      prompt_version
    ) as result;

  if not found or publication is null or jsonb_typeof(publication) <> 'object' then
    raise exception using errcode = '55000', message = 'Drive PDF finalization returned no publication';
  end if;

  return publication;
end;
$$;

create or replace function public.abandon_drive_pdf_reference_descriptor_attempt(
  target_document_id uuid,
  target_attempt_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_user_id uuid := auth.uid();
  active_attempt_id uuid;
begin
  if current_user_id is null or not public.is_authorized_user() then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;

  if target_document_id is null or target_attempt_id is null then
    raise exception using errcode = '22023', message = 'Invalid Drive PDF descriptor attempt';
  end if;

  select descriptor_attempt_id
    into active_attempt_id
    from public.drive_pdf_reference_imports
   where document_id = target_document_id
     and user_id = current_user_id
     and status = 'pending_inspection'
   for update;

  if not found or active_attempt_id is distinct from target_attempt_id then
    return false;
  end if;

  delete from public.drive_pdf_reference_page_staging
   where document_id = target_document_id
     and user_id = current_user_id
     and attempt_id = target_attempt_id;

  update public.drive_pdf_reference_imports
     set descriptor_attempt_id = null,
         descriptor_expected_page_count = null,
         descriptor_attempt_expires_at = null,
         updated_at = timezone('utc', now())
   where document_id = target_document_id
     and user_id = current_user_id
     and descriptor_attempt_id = target_attempt_id;

  return found;
end;
$$;

revoke execute on function public.stage_drive_pdf_reference_page_batch(uuid, jsonb) from authenticated;
revoke execute on function public.stage_drive_pdf_reference_page_batch(uuid, jsonb) from anon;
revoke execute on function public.finalize_staged_drive_pdf_reference_import(uuid, integer, integer) from authenticated;
revoke execute on function public.finalize_staged_drive_pdf_reference_import(uuid, integer, integer) from anon;

grant execute on function public.stage_drive_pdf_reference_page_batch(uuid, jsonb) to service_role;
grant execute on function public.finalize_staged_drive_pdf_reference_import(uuid, integer, integer) to service_role;

revoke all on function public.begin_drive_pdf_reference_descriptor_attempt(uuid, uuid, integer) from public;
revoke all on function public.begin_drive_pdf_reference_descriptor_attempt(uuid, uuid, integer) from anon;
grant execute on function public.begin_drive_pdf_reference_descriptor_attempt(uuid, uuid, integer) to authenticated;
grant execute on function public.begin_drive_pdf_reference_descriptor_attempt(uuid, uuid, integer) to service_role;

revoke all on function public.renew_drive_pdf_reference_descriptor_attempt(uuid, uuid) from public;
revoke all on function public.renew_drive_pdf_reference_descriptor_attempt(uuid, uuid) from anon;
grant execute on function public.renew_drive_pdf_reference_descriptor_attempt(uuid, uuid) to authenticated;
grant execute on function public.renew_drive_pdf_reference_descriptor_attempt(uuid, uuid) to service_role;

revoke all on function public.stage_drive_pdf_reference_descriptor_batch(uuid, uuid, jsonb) from public;
revoke all on function public.stage_drive_pdf_reference_descriptor_batch(uuid, uuid, jsonb) from anon;
grant execute on function public.stage_drive_pdf_reference_descriptor_batch(uuid, uuid, jsonb) to authenticated;
grant execute on function public.stage_drive_pdf_reference_descriptor_batch(uuid, uuid, jsonb) to service_role;

revoke all on function public.finalize_drive_pdf_reference_descriptor_attempt(uuid, uuid, integer) from public;
revoke all on function public.finalize_drive_pdf_reference_descriptor_attempt(uuid, uuid, integer) from anon;
grant execute on function public.finalize_drive_pdf_reference_descriptor_attempt(uuid, uuid, integer) to authenticated;
grant execute on function public.finalize_drive_pdf_reference_descriptor_attempt(uuid, uuid, integer) to service_role;

revoke all on function public.abandon_drive_pdf_reference_descriptor_attempt(uuid, uuid) from public;
revoke all on function public.abandon_drive_pdf_reference_descriptor_attempt(uuid, uuid) from anon;
grant execute on function public.abandon_drive_pdf_reference_descriptor_attempt(uuid, uuid) to authenticated;
grant execute on function public.abandon_drive_pdf_reference_descriptor_attempt(uuid, uuid) to service_role;
