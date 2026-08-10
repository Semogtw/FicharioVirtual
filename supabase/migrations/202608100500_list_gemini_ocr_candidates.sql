create or replace function public.list_gemini_ocr_candidates()
returns table (
  job_id uuid,
  page_id uuid,
  document_id uuid,
  document_title text,
  page_number integer,
  attempt_count integer,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null or not public.is_authorized_user() then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;

  return query
  select
    job.id,
    job.page_id,
    page.document_id,
    document.title,
    page.page_number,
    job.attempt_count,
    job.created_at,
    job.updated_at
  from public.ocr_jobs as job
  join public.pages as page
    on page.id = job.page_id
   and page.user_id = job.user_id
  join public.documents as document
    on document.id = page.document_id
   and document.user_id = job.user_id
  where job.user_id = current_user_id
    and job.route = 'gemini'::public.ocr_route
    and job.status = 'pending'::public.ocr_status
    and page.status = 'pending'::public.page_status
    and job.desktop_lease_device_id is null
    and job.desktop_lease_id is null
    and job.desktop_lease_started_at is null
    and job.desktop_lease_expires_at is null
  order by job.created_at, job.id
  limit 100;
end;
$$;

revoke execute on function public.list_gemini_ocr_candidates() from public;
revoke execute on function public.list_gemini_ocr_candidates() from anon;
grant execute on function public.list_gemini_ocr_candidates() to authenticated;
grant execute on function public.list_gemini_ocr_candidates() to service_role;
