-- Keep active desktop lease identifiers globally unique so a random lease id
-- can never authorize two jobs at the same time, even after future claim paths
-- are added.
create unique index ocr_jobs_desktop_lease_id_unique_idx
  on public.ocr_jobs (desktop_lease_id)
  where desktop_lease_id is not null;

-- Renew in the same lock order used by claim: active device first, then job.
-- The initial job lookup is intentionally non-locking and only discovers the
-- owner. The exact tuple is re-checked by the UPDATE after the device row is
-- locked, so a concurrent expiry/reclaim cannot be renewed accidentally.
create or replace function public.renew_desktop_ocr_job_lease(
  target_job_id uuid,
  target_device_id uuid,
  target_lease_id uuid,
  lease_seconds integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  lease_user_id uuid;
  renewed_page_id uuid;
  renewed_until timestamptz;
  renewed_at timestamptz;
begin
  if target_job_id is null
    or target_device_id is null
    or target_lease_id is null
    or lease_seconds is null
    or lease_seconds < 30
    or lease_seconds > 900 then
    raise exception using errcode = '22023', message = 'Invalid desktop OCR lease renewal';
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

  renewed_at := timezone('utc', now());
  renewed_until := renewed_at + make_interval(secs => lease_seconds);

  update public.ocr_jobs as job
     set desktop_lease_expires_at = renewed_until,
         updated_at = renewed_at
   where job.id = target_job_id
     and job.user_id = lease_user_id
     and job.desktop_lease_device_id = target_device_id
     and job.desktop_lease_id = target_lease_id
     and job.desktop_lease_expires_at > renewed_at
     and job.route = 'desktop'::public.ocr_route
     and job.status = 'processing'::public.ocr_status
  returning job.page_id into renewed_page_id;

  if not found then
    raise exception using errcode = '55P03', message = 'Desktop OCR lease is not active';
  end if;

  update public.ocr_worker_devices
     set last_seen_at = renewed_at,
         updated_at = renewed_at
   where id = target_device_id
     and user_id = lease_user_id;

  return jsonb_build_object(
    'jobId', target_job_id,
    'pageId', renewed_page_id,
    'deviceId', target_device_id,
    'leaseId', target_lease_id,
    'leaseExpiresAt', renewed_until
  );
end;
$$;

revoke execute on function public.renew_desktop_ocr_job_lease(uuid, uuid, uuid, integer) from public;
revoke execute on function public.renew_desktop_ocr_job_lease(uuid, uuid, uuid, integer) from anon;
revoke execute on function public.renew_desktop_ocr_job_lease(uuid, uuid, uuid, integer) from authenticated;
grant execute on function public.renew_desktop_ocr_job_lease(uuid, uuid, uuid, integer) to service_role;
