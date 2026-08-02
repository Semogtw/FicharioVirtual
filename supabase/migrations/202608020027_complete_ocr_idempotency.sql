create or replace function public.complete_ocr_job(
  target_page_id uuid,
  extracted_text text,
  extraction_warnings jsonb,
  terminal_status text,
  completed_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  current_job public.ocr_jobs%rowtype;
  current_page public.pages%rowtype;
begin
  if current_user_id is null
    or terminal_status not in ('ready', 'needs_review')
    or extracted_text is null
    or char_length(extracted_text) > 1000000
    or jsonb_typeof(extraction_warnings) <> 'array'
  then
    return false;
  end if;

  select * into current_job
  from public.ocr_jobs
  where page_id = target_page_id
    and user_id = current_user_id
  for update;

  if not found then
    return false;
  end if;

  select * into current_page
  from public.pages
  where id = target_page_id
    and user_id = current_user_id
  for update;

  if not found then
    return false;
  end if;

  if current_job.status = 'ready' then
    return current_job.finished_at is not distinct from completed_at
      and current_page.ocr_raw_text is not distinct from extracted_text
      and current_page.warnings is not distinct from extraction_warnings
      and current_page.extraction_source = 'ocr'
      and current_page.status::text = terminal_status;
  end if;

  if current_job.status <> 'processing' then
    return false;
  end if;

  update public.pages
  set ocr_raw_text = extracted_text,
      warnings = extraction_warnings,
      extraction_source = 'ocr',
      status = terminal_status::public.processing_status
  where id = target_page_id
    and user_id = current_user_id;

  update public.ocr_jobs
  set status = 'ready',
      finished_at = completed_at,
      last_error_code = null,
      last_error_message = null,
      next_retry_at = null
  where id = current_job.id;

  return true;
end;
$$;

revoke execute on function public.complete_ocr_job(uuid, text, jsonb, text, timestamptz) from public, anon;
grant execute on function public.complete_ocr_job(uuid, text, jsonb, text, timestamptz) to authenticated;
