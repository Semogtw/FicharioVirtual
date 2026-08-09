alter function public.complete_ocr_job(uuid, text, jsonb, public.page_status, timestamptz)
  rename to complete_ocr_job_result_history_v1;

revoke execute on function public.complete_ocr_job_result_history_v1(uuid, text, jsonb, public.page_status, timestamptz)
from public, anon, authenticated;
grant execute on function public.complete_ocr_job_result_history_v1(uuid, text, jsonb, public.page_status, timestamptz)
to service_role;

create or replace function public.complete_ocr_job(
  target_page_id uuid,
  extracted_text text,
  extraction_warnings jsonb,
  terminal_status public.page_status,
  completed_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  current_route public.ocr_route;
begin
  if current_user_id is null or not public.is_authorized_user() then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;

  if target_page_id is null then
    raise exception using errcode = '22023', message = 'Invalid OCR completion request';
  end if;

  select job.route
    into current_route
    from public.ocr_jobs as job
   where job.page_id = target_page_id
     and job.user_id = current_user_id
   for update;

  if not found then
    raise exception using errcode = '55000', message = 'OCR job is unavailable for completion';
  end if;

  if current_route is distinct from 'gemini'::public.ocr_route then
    raise exception using
      errcode = '55000',
      message = 'Desktop-routed OCR jobs require the desktop completion boundary';
  end if;

  perform public.complete_ocr_job_result_history_v1(
    target_page_id,
    extracted_text,
    extraction_warnings,
    terminal_status,
    completed_at
  );
end;
$$;

revoke execute on function public.complete_ocr_job(uuid, text, jsonb, public.page_status, timestamptz) from public;
revoke execute on function public.complete_ocr_job(uuid, text, jsonb, public.page_status, timestamptz) from anon;
grant execute on function public.complete_ocr_job(uuid, text, jsonb, public.page_status, timestamptz) to authenticated;
grant execute on function public.complete_ocr_job(uuid, text, jsonb, public.page_status, timestamptz) to service_role;
