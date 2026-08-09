-- Keep leased publication scalar-safe: the hardened Drive PDF finalizer returns
-- one jsonb value, so assign it directly rather than selecting a whole-row alias
-- into a jsonb variable.

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

  publication := public.finalize_drive_pdf_reference_import(
    target_document_id,
    staged_descriptors,
    prompt_version
  );

  if publication is null or jsonb_typeof(publication) <> 'object' then
    raise exception using errcode = '55000', message = 'Drive PDF finalization returned no publication';
  end if;

  return publication;
end;
$$;

revoke all on function public.finalize_drive_pdf_reference_descriptor_attempt(uuid, uuid, integer) from public;
revoke all on function public.finalize_drive_pdf_reference_descriptor_attempt(uuid, uuid, integer) from anon;
grant execute on function public.finalize_drive_pdf_reference_descriptor_attempt(uuid, uuid, integer) to authenticated;
grant execute on function public.finalize_drive_pdf_reference_descriptor_attempt(uuid, uuid, integer) to service_role;
