create table public.drive_pdf_reference_page_descriptors (
  document_id uuid not null references public.drive_pdf_reference_imports(document_id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  page_number integer not null check (page_number > 0),
  page_id uuid not null,
  native_text text,
  needs_ocr boolean not null,
  temporary_image_path text,
  job_id uuid,
  created_at timestamptz not null default now(),
  primary key (document_id, page_number),
  unique (document_id, page_id),
  unique (document_id, job_id),
  constraint drive_pdf_reference_page_descriptors_shape check (
    (
      needs_ocr
      and native_text is null
      and temporary_image_path is not null
      and job_id is not null
      and char_length(temporary_image_path) between 1 and 1024
      and (
        temporary_image_path = user_id::text || '/' || document_id::text || '/pages/' || page_number::text || '.webp'
        or temporary_image_path = user_id::text || '/' || document_id::text || '/pages/' || page_number::text || '.jpg'
      )
    )
    or (
      not needs_ocr
      and native_text is not null
      and char_length(native_text) <= 120000
      and temporary_image_path is null
      and job_id is null
    )
  )
);

alter table public.drive_pdf_reference_page_descriptors enable row level security;

create policy "Users can read their Drive PDF reference page descriptors"
  on public.drive_pdf_reference_page_descriptors
  for select
  to authenticated
  using (user_id = (select auth.uid()));

revoke all on table public.drive_pdf_reference_page_descriptors from anon, authenticated;
grant select on public.drive_pdf_reference_page_descriptors to authenticated;
revoke insert, update, delete on table public.drive_pdf_reference_page_descriptors from authenticated;
grant all on table public.drive_pdf_reference_page_descriptors to service_role;

create or replace function public.stage_drive_pdf_reference_page_batch(
  target_document_id uuid,
  page_descriptors jsonb
)
returns table (
  document_id uuid,
  accepted_count integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  staged_reference public.drive_pdf_reference_imports%rowtype;
  descriptor jsonb;
  descriptor_key_count integer;
  page_number_numeric numeric;
  parsed_page_number integer;
  page_id_text text;
  parsed_page_id uuid;
  parsed_native_text text;
  parsed_needs_ocr boolean;
  parsed_temporary_image_path text;
  job_id_text text;
  parsed_job_id uuid;
  existing_descriptor public.drive_pdf_reference_page_descriptors%rowtype;
  inserted_count integer;
  total_accepted integer := 0;
begin
  if current_user_id is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;

  if target_document_id is null then
    raise exception using errcode = '22023', message = 'Invalid Drive PDF document id';
  end if;

  if page_descriptors is null
    or jsonb_typeof(page_descriptors) <> 'array'
    or jsonb_array_length(page_descriptors) < 1
    or jsonb_array_length(page_descriptors) > 100 then
    raise exception using errcode = '22023', message = 'Invalid Drive PDF page descriptor batch';
  end if;

  select reference.*
    into staged_reference
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
    raise exception using errcode = '55000', message = 'Drive PDF reference is unavailable for page staging';
  end if;

  for descriptor in select value from jsonb_array_elements(page_descriptors)
  loop
    if jsonb_typeof(descriptor) <> 'object' then
      raise exception using errcode = '22023', message = 'Invalid Drive PDF page descriptor';
    end if;

    select count(*)
      into descriptor_key_count
      from jsonb_object_keys(descriptor);

    if descriptor_key_count <> 6
      or not (descriptor ?& array['id', 'pageNumber', 'nativeText', 'needsOcr', 'temporaryImagePath', 'jobId']) then
      raise exception using errcode = '22023', message = 'Invalid Drive PDF page descriptor keys';
    end if;

    if jsonb_typeof(descriptor -> 'pageNumber') <> 'number' then
      raise exception using errcode = '22023', message = 'Invalid Drive PDF page number';
    end if;

    begin
      page_number_numeric := (descriptor ->> 'pageNumber')::numeric;
    exception
      when invalid_text_representation or numeric_value_out_of_range then
        raise exception using errcode = '22023', message = 'Invalid Drive PDF page number';
    end;

    if page_number_numeric <> trunc(page_number_numeric)
      or page_number_numeric < 1
      or page_number_numeric > 2147483647 then
      raise exception using errcode = '22023', message = 'Invalid Drive PDF page number';
    end if;
    parsed_page_number := page_number_numeric::integer;

    if jsonb_typeof(descriptor -> 'id') <> 'string' then
      raise exception using errcode = '22023', message = 'Invalid Drive PDF page id';
    end if;
    page_id_text := descriptor ->> 'id';
    begin
      parsed_page_id := page_id_text::uuid;
    exception
      when invalid_text_representation then
        raise exception using errcode = '22023', message = 'Invalid Drive PDF page id';
    end;
    if parsed_page_id::text <> lower(page_id_text) then
      raise exception using errcode = '22023', message = 'Invalid Drive PDF page id';
    end if;

    if jsonb_typeof(descriptor -> 'needsOcr') <> 'boolean' then
      raise exception using errcode = '22023', message = 'Invalid Drive PDF OCR flag';
    end if;
    parsed_needs_ocr := (descriptor ->> 'needsOcr')::boolean;

    if parsed_needs_ocr then
      if jsonb_typeof(descriptor -> 'nativeText') <> 'null'
        or jsonb_typeof(descriptor -> 'temporaryImagePath') <> 'string'
        or jsonb_typeof(descriptor -> 'jobId') <> 'string' then
        raise exception using errcode = '22023', message = 'Invalid Drive PDF OCR descriptor';
      end if;

      parsed_native_text := null;
      parsed_temporary_image_path := descriptor ->> 'temporaryImagePath';
      if char_length(parsed_temporary_image_path) < 1
        or char_length(parsed_temporary_image_path) > 1024
        or parsed_temporary_image_path not in (
          staged_reference.user_id::text || '/' || target_document_id::text || '/pages/' || parsed_page_number::text || '.webp',
          staged_reference.user_id::text || '/' || target_document_id::text || '/pages/' || parsed_page_number::text || '.jpg'
        ) then
        raise exception using errcode = '22023', message = 'Invalid Drive PDF temporary image path';
      end if;

      job_id_text := descriptor ->> 'jobId';
      begin
        parsed_job_id := job_id_text::uuid;
      exception
        when invalid_text_representation then
          raise exception using errcode = '22023', message = 'Invalid Drive PDF OCR job id';
      end;
      if parsed_job_id::text <> lower(job_id_text) then
        raise exception using errcode = '22023', message = 'Invalid Drive PDF OCR job id';
      end if;
    else
      if jsonb_typeof(descriptor -> 'nativeText') <> 'string'
        or jsonb_typeof(descriptor -> 'temporaryImagePath') <> 'null'
        or jsonb_typeof(descriptor -> 'jobId') <> 'null' then
        raise exception using errcode = '22023', message = 'Invalid Drive PDF native-text descriptor';
      end if;

      parsed_native_text := descriptor ->> 'nativeText';
      if char_length(parsed_native_text) > 120000 then
        raise exception using errcode = '22023', message = 'Drive PDF native text is too large';
      end if;
      parsed_temporary_image_path := null;
      parsed_job_id := null;
    end if;

    begin
      insert into public.drive_pdf_reference_page_descriptors (
        document_id,
        user_id,
        page_number,
        page_id,
        native_text,
        needs_ocr,
        temporary_image_path,
        job_id
      ) values (
        target_document_id,
        staged_reference.user_id,
        parsed_page_number,
        parsed_page_id,
        parsed_native_text,
        parsed_needs_ocr,
        parsed_temporary_image_path,
        parsed_job_id
      )
      on conflict (document_id, page_number) do nothing;
      get diagnostics inserted_count = row_count;
    exception
      when unique_violation then
        raise exception using errcode = '22023', message = 'Drive PDF page descriptor identity conflict';
    end;

    if inserted_count = 0 then
      select descriptor_row.*
        into existing_descriptor
        from public.drive_pdf_reference_page_descriptors as descriptor_row
       where descriptor_row.document_id = target_document_id
         and descriptor_row.page_number = parsed_page_number;

      if not found
        or existing_descriptor.user_id <> staged_reference.user_id
        or existing_descriptor.page_id <> parsed_page_id
        or existing_descriptor.native_text is distinct from parsed_native_text
        or existing_descriptor.needs_ocr <> parsed_needs_ocr
        or existing_descriptor.temporary_image_path is distinct from parsed_temporary_image_path
        or existing_descriptor.job_id is distinct from parsed_job_id then
        raise exception using errcode = '22023', message = 'Drive PDF page descriptor retry mismatch';
      end if;
    end if;

    total_accepted := total_accepted + 1;
  end loop;

  return query select target_document_id, total_accepted;
end;
$$;

revoke execute on function public.stage_drive_pdf_reference_page_batch(uuid, jsonb) from public;
revoke execute on function public.stage_drive_pdf_reference_page_batch(uuid, jsonb) from anon;
grant execute on function public.stage_drive_pdf_reference_page_batch(uuid, jsonb) to authenticated;
grant execute on function public.stage_drive_pdf_reference_page_batch(uuid, jsonb) to service_role;
