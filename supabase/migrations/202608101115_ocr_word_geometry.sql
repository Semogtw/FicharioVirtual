-- Persist word-level OCR geometry with normalized integer coordinates.
-- Coordinates use a 0..10000 grid with a top-left origin, so highlights are
-- independent from the source image resolution and the viewer zoom level.

alter table public.pages
  add column ocr_word_geometry jsonb not null default '[]'::jsonb;

alter table public.ocr_results
  add column word_geometry jsonb not null default '[]'::jsonb;

create or replace function public.is_valid_ocr_word_geometry(geometry jsonb)
returns boolean
language plpgsql
immutable
strict
parallel safe
set search_path = ''
as $$
declare
  item jsonb;
  word_text text;
  left_text text;
  top_text text;
  right_text text;
  bottom_text text;
  left_value integer;
  top_value integer;
  right_value integer;
  bottom_value integer;
begin
  if jsonb_typeof(geometry) <> 'array'
    or jsonb_array_length(geometry) > 20000
    or pg_column_size(geometry) > 4194304
  then
    return false;
  end if;

  for item in select value from jsonb_array_elements(geometry)
  loop
    if jsonb_typeof(item) <> 'array' or jsonb_array_length(item) <> 5 then
      return false;
    end if;

    word_text := item ->> 0;
    left_text := item ->> 1;
    top_text := item ->> 2;
    right_text := item ->> 3;
    bottom_text := item ->> 4;

    if word_text is null
      or char_length(word_text) not between 1 and 256
      or word_text <> btrim(word_text)
      or word_text ~ '[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]'
      or left_text !~ '^[0-9]{1,5}$'
      or top_text !~ '^[0-9]{1,5}$'
      or right_text !~ '^[0-9]{1,5}$'
      or bottom_text !~ '^[0-9]{1,5}$'
    then
      return false;
    end if;

    left_value := left_text::integer;
    top_value := top_text::integer;
    right_value := right_text::integer;
    bottom_value := bottom_text::integer;

    if left_value < 0 or top_value < 0
      or right_value > 10000 or bottom_value > 10000
      or right_value <= left_value or bottom_value <= top_value
    then
      return false;
    end if;
  end loop;

  return true;
end;
$$;

alter table public.pages
  add constraint pages_ocr_word_geometry_valid
  check (public.is_valid_ocr_word_geometry(ocr_word_geometry));

alter table public.ocr_results
  add constraint ocr_results_word_geometry_valid
  check (public.is_valid_ocr_word_geometry(word_geometry));

create or replace function public.complete_ocr_job_with_geometry(
  target_page_id uuid,
  extracted_text text,
  extraction_warnings jsonb,
  terminal_status public.page_status,
  completed_at timestamptz,
  geometry_payload jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  accepted_result_id uuid;
begin
  if current_user_id is null or not public.is_authorized_user() then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;
  if geometry_payload is null or not public.is_valid_ocr_word_geometry(geometry_payload) then
    raise exception using errcode = '22023', message = 'Invalid OCR word geometry';
  end if;

  perform public.complete_ocr_job(
    target_page_id,
    extracted_text,
    extraction_warnings,
    terminal_status,
    completed_at
  );

  select page.accepted_ocr_result_id
    into accepted_result_id
    from public.pages as page
   where page.id = target_page_id
     and page.user_id = current_user_id
   for update;

  if accepted_result_id is null then
    raise exception using errcode = '55000', message = 'OCR result is unavailable after completion';
  end if;

  update public.ocr_results as result
     set word_geometry = geometry_payload
   where result.id = accepted_result_id
     and result.page_id = target_page_id
     and result.user_id = current_user_id
     and (result.word_geometry = '[]'::jsonb or result.word_geometry is not distinct from geometry_payload);

  if not found then
    raise exception using errcode = '22023', message = 'OCR word geometry conflicts with the persisted result';
  end if;

  update public.pages as page
     set ocr_word_geometry = geometry_payload
   where page.id = target_page_id
     and page.user_id = current_user_id
     and page.accepted_ocr_result_id = accepted_result_id
     and (page.ocr_word_geometry = '[]'::jsonb or page.ocr_word_geometry is not distinct from geometry_payload);

  if not found then
    raise exception using errcode = '22023', message = 'OCR word geometry conflicts with the page summary';
  end if;
end;
$$;

create or replace function public.complete_desktop_ocr_job_with_geometry(
  target_job_id uuid,
  target_device_id uuid,
  target_lease_id uuid,
  target_source_sha256 text,
  target_backend text,
  target_model text,
  target_model_version text,
  extracted_text text,
  target_corrected_text text,
  target_content_type text,
  extraction_warnings jsonb,
  needs_review boolean,
  timing_ms integer,
  geometry_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  completion jsonb;
  completed_page_id uuid;
  completed_result_id uuid;
begin
  if geometry_payload is null or not public.is_valid_ocr_word_geometry(geometry_payload) then
    raise exception using errcode = '22023', message = 'Invalid OCR word geometry';
  end if;

  completion := public.complete_desktop_ocr_job(
    target_job_id,
    target_device_id,
    target_lease_id,
    target_source_sha256,
    target_backend,
    target_model,
    target_model_version,
    extracted_text,
    target_corrected_text,
    target_content_type,
    extraction_warnings,
    needs_review,
    timing_ms
  );

  completed_page_id := (completion ->> 'pageId')::uuid;
  completed_result_id := (completion ->> 'resultId')::uuid;

  update public.ocr_results as result
     set word_geometry = geometry_payload
   where result.id = completed_result_id
     and result.page_id = completed_page_id
     and result.ocr_job_id = target_job_id
     and (result.word_geometry = '[]'::jsonb or result.word_geometry is not distinct from geometry_payload);

  if not found then
    raise exception using errcode = '22023', message = 'Desktop OCR word geometry conflicts with the persisted result';
  end if;

  update public.pages as page
     set ocr_word_geometry = geometry_payload
   where page.id = completed_page_id
     and page.accepted_ocr_result_id = completed_result_id
     and (page.ocr_word_geometry = '[]'::jsonb or page.ocr_word_geometry is not distinct from geometry_payload);

  if not found then
    raise exception using errcode = '22023', message = 'Desktop OCR word geometry conflicts with the page summary';
  end if;

  return completion;
end;
$$;

revoke execute on function public.is_valid_ocr_word_geometry(jsonb) from public, anon, authenticated;
revoke execute on function public.complete_ocr_job_with_geometry(uuid, text, jsonb, public.page_status, timestamptz, jsonb)
  from public, anon;
grant execute on function public.complete_ocr_job_with_geometry(uuid, text, jsonb, public.page_status, timestamptz, jsonb)
  to authenticated, service_role;

revoke execute on function public.complete_desktop_ocr_job_with_geometry(
  uuid, uuid, uuid, text, text, text, text, text, text, text, jsonb, boolean, integer, jsonb
) from public, anon, authenticated;
grant execute on function public.complete_desktop_ocr_job_with_geometry(
  uuid, uuid, uuid, text, text, text, text, text, text, text, jsonb, boolean, integer, jsonb
) to service_role;
