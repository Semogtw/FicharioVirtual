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
      and descriptor_expected_page_count is not null
      and descriptor_expected_page_count > 0
      and descriptor_attempt_expires_at is not null
    )
  );

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
  lease_until timestamptz := now() + interval '15 minutes';
begin
  if current_user_id is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;

  if target_document_id is null
    or target_attempt_id is null
    or expected_page_count is null
    or expected_page_count < 1 then
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
           updated_at = now()
     where document_id = target_document_id
       and user_id = current_user_id;

    return jsonb_build_object(
      'documentId', target_document_id,
      'attemptId', target_attempt_id,
      'expectedPageCount', expected_page_count,
      'expiresAt', lease_until
    );
  end if;

  if reference_row.descriptor_attempt_id is not null
    and reference_row.descriptor_attempt_expires_at > now() then
    raise exception using errcode = '55P03', message = 'Another Drive PDF descriptor attempt is active';
  end if;

  delete from public.drive_pdf_reference_page_descriptors
   where document_id = target_document_id
     and user_id = current_user_id;

  update public.drive_pdf_reference_imports
     set descriptor_attempt_id = target_attempt_id,
         descriptor_expected_page_count = expected_page_count,
         descriptor_attempt_expires_at = lease_until,
         updated_at = now()
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

create or replace function public.stage_drive_pdf_reference_page_batch(
  target_document_id uuid,
  target_attempt_id uuid,
  page_descriptors jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_user_id uuid := auth.uid();
  reference_row public.drive_pdf_reference_imports%rowtype;
  accepted integer;
  lease_until timestamptz := now() + interval '15 minutes';
begin
  if current_user_id is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;

  if target_document_id is null or target_attempt_id is null then
    raise exception using errcode = '22023', message = 'Invalid Drive PDF descriptor attempt';
  end if;

  select reference.*
    into reference_row
    from public.drive_pdf_reference_imports as reference
   where reference.document_id = target_document_id
     and reference.user_id = current_user_id
     and reference.status = 'pending_inspection'
   for update;

  if not found then
    raise exception using errcode = '55000', message = 'Drive PDF reference is unavailable for descriptor staging';
  end if;

  if reference_row.descriptor_attempt_id is distinct from target_attempt_id
    or reference_row.descriptor_attempt_expires_at is null
    or reference_row.descriptor_attempt_expires_at <= now() then
    raise exception using errcode = '55P03', message = 'Drive PDF descriptor attempt lease is not active';
  end if;

  select result.accepted_count
    into accepted
    from public.stage_drive_pdf_reference_page_batch(target_document_id, page_descriptors) as result;

  if accepted is null then
    raise exception using errcode = '55000', message = 'Drive PDF descriptor batch staging returned no result';
  end if;

  update public.drive_pdf_reference_imports
     set descriptor_attempt_expires_at = lease_until,
         updated_at = now()
   where document_id = target_document_id
     and user_id = current_user_id
     and descriptor_attempt_id = target_attempt_id;

  return jsonb_build_object(
    'documentId', target_document_id,
    'attemptId', target_attempt_id,
    'acceptedCount', accepted,
    'expiresAt', lease_until
  );
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
  if current_user_id is null then
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

  delete from public.drive_pdf_reference_page_descriptors
   where document_id = target_document_id
     and user_id = current_user_id;

  update public.drive_pdf_reference_imports
     set descriptor_attempt_id = null,
         descriptor_expected_page_count = null,
         descriptor_attempt_expires_at = null,
         updated_at = now()
   where document_id = target_document_id
     and user_id = current_user_id;

  return true;
end;
$$;

create or replace function public.finalize_staged_drive_pdf_reference_import(
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
  reference_row public.drive_pdf_reference_imports%rowtype;
  publication jsonb;
begin
  if current_user_id is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;

  if target_document_id is null
    or target_attempt_id is null
    or prompt_version is null
    or prompt_version < 1
    or prompt_version > 10000 then
    raise exception using errcode = '22023', message = 'Invalid Drive PDF descriptor finalization request';
  end if;

  select reference.*
    into reference_row
    from public.drive_pdf_reference_imports as reference
   where reference.document_id = target_document_id
     and reference.user_id = current_user_id
     and reference.status = 'pending_inspection'
   for update;

  if not found then
    raise exception using errcode = '55000', message = 'Drive PDF reference is unavailable for descriptor finalization';
  end if;

  if reference_row.descriptor_attempt_id is distinct from target_attempt_id
    or reference_row.descriptor_expected_page_count is null
    or reference_row.descriptor_attempt_expires_at is null
    or reference_row.descriptor_attempt_expires_at <= now() then
    raise exception using errcode = '55P03', message = 'Drive PDF descriptor attempt lease is not active';
  end if;

  publication := public.finalize_staged_drive_pdf_reference_import(
    target_document_id,
    reference_row.descriptor_expected_page_count,
    prompt_version
  );

  if publication is null or jsonb_typeof(publication) <> 'object' then
    raise exception using errcode = '55000', message = 'Drive PDF staged finalization returned no publication';
  end if;

  return publication;
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

revoke all on function public.stage_drive_pdf_reference_page_batch(uuid, uuid, jsonb) from public;
revoke all on function public.stage_drive_pdf_reference_page_batch(uuid, uuid, jsonb) from anon;
grant execute on function public.stage_drive_pdf_reference_page_batch(uuid, uuid, jsonb) to authenticated;
grant execute on function public.stage_drive_pdf_reference_page_batch(uuid, uuid, jsonb) to service_role;

revoke all on function public.abandon_drive_pdf_reference_descriptor_attempt(uuid, uuid) from public;
revoke all on function public.abandon_drive_pdf_reference_descriptor_attempt(uuid, uuid) from anon;
grant execute on function public.abandon_drive_pdf_reference_descriptor_attempt(uuid, uuid) to authenticated;
grant execute on function public.abandon_drive_pdf_reference_descriptor_attempt(uuid, uuid) to service_role;

revoke all on function public.finalize_staged_drive_pdf_reference_import(uuid, uuid, integer) from public;
revoke all on function public.finalize_staged_drive_pdf_reference_import(uuid, uuid, integer) from anon;
grant execute on function public.finalize_staged_drive_pdf_reference_import(uuid, uuid, integer) to authenticated;
grant execute on function public.finalize_staged_drive_pdf_reference_import(uuid, uuid, integer) to service_role;
