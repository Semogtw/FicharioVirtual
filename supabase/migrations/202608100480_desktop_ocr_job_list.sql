create or replace function public.list_desktop_ocr_jobs()
returns table (
  job_id uuid,
  page_id uuid,
  document_id uuid,
  document_title text,
  page_number integer,
  status text,
  attempt_count integer,
  last_error_code text,
  device_id uuid,
  device_label text,
  lease_started_at timestamptz,
  lease_expires_at timestamptz,
  lease_expired boolean,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  observed_at timestamptz := timezone('utc', now());
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
    job.status::text,
    job.attempt_count,
    job.last_error_code,
    job.desktop_lease_device_id,
    device.label,
    job.desktop_lease_started_at,
    job.desktop_lease_expires_at,
    (
      job.status = 'processing'::public.ocr_status
      and job.desktop_lease_expires_at is not null
      and job.desktop_lease_expires_at <= observed_at
    ),
    job.created_at,
    job.updated_at
  from public.ocr_jobs as job
  join public.pages as page
    on page.id = job.page_id
   and page.user_id = job.user_id
  join public.documents as document
    on document.id = page.document_id
   and document.user_id = job.user_id
  left join public.ocr_worker_devices as device
    on device.id = job.desktop_lease_device_id
   and device.user_id = job.user_id
  where job.user_id = current_user_id
    and job.route = 'desktop'::public.ocr_route
  order by
    case job.status
      when 'processing'::public.ocr_status then 0
      when 'waiting_desktop'::public.ocr_status then 1
      when 'retryable'::public.ocr_status then 2
      else 3
    end,
    job.updated_at desc,
    job.id
  limit 100;
end;
$$;

revoke execute on function public.list_desktop_ocr_jobs() from public;
revoke execute on function public.list_desktop_ocr_jobs() from anon;
grant execute on function public.list_desktop_ocr_jobs() to authenticated;
grant execute on function public.list_desktop_ocr_jobs() to service_role;
