create or replace function public.create_image_import(
  target_document_id uuid,
  target_page_id uuid,
  target_job_id uuid,
  target_notebook_id uuid,
  document_title text,
  original_filename text,
  original_storage_path text,
  thumbnail_storage_path text,
  prepared_sha256 text,
  source_created_at timestamptz default null,
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
  if char_length(trim(document_title)) not between 1 and 240 then
    raise exception 'invalid document title' using errcode = '22023';
  end if;
  if char_length(original_filename) not between 1 and 512 then
    raise exception 'invalid filename' using errcode = '22023';
  end if;
  if prepared_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid digest' using errcode = '22023';
  end if;
  if original_storage_path not like current_user_id::text || '/%'
    or thumbnail_storage_path not like current_user_id::text || '/%'
  then
    raise exception 'invalid storage ownership' using errcode = '42501';
  end if;
  if target_notebook_id is not null and not exists (
    select 1 from public.notebooks
    where id = target_notebook_id and user_id = current_user_id
  ) then
    raise exception 'invalid notebook' using errcode = '23503';
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
    target_notebook_id,
    trim(document_title),
    'image',
    original_filename,
    original_storage_path,
    thumbnail_storage_path,
    1,
    'pending',
    prepared_sha256,
    source_created_at
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

revoke execute on function public.create_image_import(
  uuid, uuid, uuid, uuid, text, text, text, text, text, timestamptz, integer
) from public, anon;
grant execute on function public.create_image_import(
  uuid, uuid, uuid, uuid, text, text, text, text, text, timestamptz, integer
) to authenticated;
