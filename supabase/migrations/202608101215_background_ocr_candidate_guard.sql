create or replace function public.list_background_gemini_ocr_candidates(result_limit integer default 24)
returns table (
  user_id uuid,
  job_id uuid,
  page_id uuid,
  document_id uuid,
  page_number integer,
  attempt_count integer,
  batch_id uuid,
  temporary_image_path text,
  document_kind public.document_kind,
  document_storage_path text
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if result_limit is null or result_limit < 1 or result_limit > 100 then
    raise exception using errcode = '22023', message = 'Invalid background OCR limit';
  end if;

  return query
  select
    job.user_id,
    job.id,
    page.id,
    page.document_id,
    page.page_number,
    job.attempt_count,
    job.batch_id,
    page.temporary_image_path,
    document.kind,
    document.storage_path
  from public.ocr_jobs as job
  join public.pages as page
    on page.id = job.page_id
   and page.user_id = job.user_id
  join public.documents as document
    on document.id = page.document_id
   and document.user_id = job.user_id
  join public.app_users as app_user
    on app_user.user_id = job.user_id
   and app_user.is_active = true
   and app_user.ocr_consent_at is not null
   and app_user.ocr_consent_version >= 1
  where job.route = 'gemini'::public.ocr_route
    and (
      (
        job.status in ('pending'::public.ocr_status, 'retryable'::public.ocr_status)
        and (job.next_retry_at is null or job.next_retry_at <= timezone('utc', now()))
      )
      or (
        job.status = 'blocked_quota'::public.ocr_status
        and job.next_retry_at is not null
        and job.next_retry_at <= timezone('utc', now())
      )
    )
    and page.status in (
      'pending'::public.page_status,
      'retryable'::public.page_status,
      'blocked_quota'::public.page_status
    )
    and job.desktop_lease_device_id is null
    and job.desktop_lease_id is null
    and job.desktop_lease_started_at is null
    and job.desktop_lease_expires_at is null
    and (
      page.temporary_image_path is not null
      or (document.kind = 'image'::public.document_kind and document.storage_path is not null)
    )
  order by job.created_at, job.id
  limit result_limit;
end;
$$;

revoke execute on function public.list_background_gemini_ocr_candidates(integer) from public, anon, authenticated;
grant execute on function public.list_background_gemini_ocr_candidates(integer) to service_role;
