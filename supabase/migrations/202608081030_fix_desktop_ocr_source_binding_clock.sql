-- 202608081028 resolved its timestamp variable as a time-of-day expression,
-- which compared a time-of-day to lease timestamps.
create or replace function public.bind_desktop_ocr_job_source_hash(
  target_job_id uuid,
  target_device_id uuid,
  target_lease_id uuid,
  target_source_sha256 text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  lease_user_id uuid;
  bound_page_id uuid;
  bound_sha256 text;
  bound_at timestamptz;
  current_utc timestamptz := timezone('utc', now());
begin
  if target_job_id is null
    or target_device_id is null
    or target_lease_id is null
    or target_source_sha256 is null
    or target_source_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'Invalid desktop OCR source binding';
  end if;

  select job.user_id
    into lease_user_id
    from public.ocr_jobs as job
   where job.id = target_job_id
     and job.desktop_lease_device_id = target_device_id
     and job.desktop_lease_id = target_lease_id;

  if not found then
    raise exception using errcode = '55P03', message = 'Desktop OCR lease is not active';
  end if;

  perform 1
    from public.ocr_worker_devices as device
   where device.id = target_device_id
     and device.user_id = lease_user_id
     and device.status = 'active'
   for update;

  if not found then
    raise exception using errcode = '55P03', message = 'Desktop OCR lease is not active';
  end if;

  update public.ocr_jobs as job
     set desktop_source_sha256 = target_source_sha256,
         desktop_source_bound_at = coalesce(job.desktop_source_bound_at, current_utc),
         updated_at = current_utc
   where job.id = target_job_id
     and job.user_id = lease_user_id
     and job.desktop_lease_device_id = target_device_id
     and job.desktop_lease_id = target_lease_id
     and job.desktop_lease_expires_at > current_utc
     and job.route = 'desktop'::public.ocr_route
     and job.status = 'processing'::public.ocr_status
     and (
       job.desktop_source_sha256 is null
       or job.desktop_source_sha256 = target_source_sha256
     )
  returning job.page_id, job.desktop_source_sha256, job.desktop_source_bound_at
       into bound_page_id, bound_sha256, bound_at;

  if not found then
    raise exception using errcode = '22023', message = 'Desktop OCR source binding conflicts with the active lease';
  end if;

  update public.ocr_worker_devices
     set last_seen_at = current_utc,
         updated_at = current_utc
   where id = target_device_id
     and user_id = lease_user_id;

  return jsonb_build_object(
    'jobId', target_job_id,
    'pageId', bound_page_id,
    'deviceId', target_device_id,
    'leaseId', target_lease_id,
    'sourceSha256', bound_sha256,
    'sourceBoundAt', bound_at
  );
end;
$$;

revoke execute on function public.bind_desktop_ocr_job_source_hash(uuid, uuid, uuid, text) from public;
revoke execute on function public.bind_desktop_ocr_job_source_hash(uuid, uuid, uuid, text) from anon;
revoke execute on function public.bind_desktop_ocr_job_source_hash(uuid, uuid, uuid, text) from authenticated;
grant execute on function public.bind_desktop_ocr_job_source_hash(uuid, uuid, uuid, text) to service_role;
