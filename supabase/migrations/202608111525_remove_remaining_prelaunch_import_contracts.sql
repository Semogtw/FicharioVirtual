-- Final launch-baseline cleanup for import surfaces that were superseded before first use.
-- Keep historical migrations intact, but do not expose Supabase-original import APIs in the
-- resulting schema. The application launches on Drive-first imports only.

-- The staging OCR check still needs to create one synthetic image without depending on
-- Google Drive. Give it a deliberately narrow, non-production-shaped fixture RPC instead
-- of retaining any former user-facing import contract.
create or replace function public.create_ocr_staging_probe(
  target_document_id uuid,
  target_page_id uuid,
  target_job_id uuid,
  image_storage_path text,
  prepared_sha256 text,
  prompt_version integer default 1
)
returns table (
  document_id uuid,
  page_id uuid,
  ocr_job_id uuid
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
begin
  if current_user_id is null or not (select public.is_authorized_user()) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if target_document_id is null or target_page_id is null or target_job_id is null
    or prepared_sha256 !~ '^[0-9a-f]{64}$'
    or prompt_version not between 1 and 10000
    or image_storage_path not like current_user_id::text || '/staging-probes/%'
    or image_storage_path !~ '^[A-Za-z0-9_./-]+[.]png$'
  then
    raise exception 'invalid OCR staging probe' using errcode = '22023';
  end if;

  insert into public.documents (
    id,
    user_id,
    notebook_id,
    title,
    kind,
    original_filename,
    storage_path,
    thumbnail_path,
    page_count,
    status,
    sha256,
    source_created_at
  ) values (
    target_document_id,
    current_user_id,
    null,
    '__staging_ocr_probe__',
    'image',
    'ocr-staging-probe.png',
    image_storage_path,
    null,
    1,
    'pending',
    prepared_sha256,
    null
  );

  insert into public.pages (
    id,
    user_id,
    document_id,
    page_number,
    status
  ) values (
    target_page_id,
    current_user_id,
    target_document_id,
    1,
    'pending'
  );

  insert into public.ocr_jobs (
    id,
    user_id,
    page_id,
    provider,
    prompt_version,
    status,
    idempotency_key
  ) values (
    target_job_id,
    current_user_id,
    target_page_id,
    'gemini',
    prompt_version,
    'pending',
    'ocr:' || target_page_id::text || ':v' || prompt_version::text
  );

  return query select target_document_id, target_page_id, target_job_id;
end;
$$;

revoke execute on function public.create_ocr_staging_probe(uuid, uuid, uuid, text, text, integer)
  from public, anon;
grant execute on function public.create_ocr_staging_probe(uuid, uuid, uuid, text, text, integer)
  to authenticated;

-- Drop every overload of the retired import names. Their current replacements have distinct
-- names, so this cannot remove create_drive_image_import_v2 or any current OCR completion RPC.
do $$
declare
  target record;
begin
  for target in
    select
      namespace.nspname as schema_name,
      procedure.proname as function_name,
      pg_get_function_identity_arguments(procedure.oid) as identity_arguments
    from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname in (
        'create_image_import',
        'create_image_import_v2',
        'create_pdf_import',
        'create_drive_image_import'
      )
  loop
    execute format(
      'drop function if exists %I.%I(%s)',
      target.schema_name,
      target.function_name,
      target.identity_arguments
    );
  end loop;
end;
$$;