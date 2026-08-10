create or replace function public.claim_desktop_ocr_job(
  target_user_id uuid,
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
  claimed_job_id uuid;
  claimed_page_id uuid;
  lease_started_at timestamptz := timezone('utc', now());
  lease_until timestamptz;
begin
  if target_user_id is null
    or target_device_id is null
    or target_lease_id is null
    or lease_seconds is null
    or lease_seconds < 30
    or lease_seconds > 900 then
    raise exception using errcode = '22023', message = 'Invalid desktop OCR lease request';
  end if;

  lease_until := lease_started_at + make_interval(secs => lease_seconds);

  perform 1
    from public.ocr_worker_devices as device
   where device.id = target_device_id
     and device.user_id = target_user_id
     and device.status = 'active'
   for update;

  if not found then
    raise exception using errcode = '55000', message = 'Desktop OCR device is unavailable';
  end if;

  -- A crashed/offline worker cannot call the service-only expiry RPC itself.
  -- Reap this owner's expired leases inside the next authenticated device
  -- claim transaction so work cannot remain stuck in processing forever.
  update public.ocr_jobs
     set status = 'waiting_desktop'::public.ocr_status,
         desktop_lease_device_id = null,
         desktop_lease_id = null,
         desktop_lease_expires_at = null,
         desktop_lease_started_at = null,
         updated_at = lease_started_at
   where user_id = target_user_id
     and route = 'desktop'::public.ocr_route
     and status = 'processing'::public.ocr_status
     and desktop_lease_expires_at <= lease_started_at;

  select job.id, job.page_id
    into claimed_job_id, claimed_page_id
    from public.ocr_jobs as job
   where job.user_id = target_user_id
     and job.route = 'desktop'::public.ocr_route
     and job.status = 'waiting_desktop'::public.ocr_status
     and job.desktop_lease_id is null
   order by job.created_at, job.id
   for update skip locked
   limit 1;

  if not found then
    return null;
  end if;

  update public.ocr_jobs
     set status = 'processing'::public.ocr_status,
         desktop_lease_device_id = target_device_id,
         desktop_lease_id = target_lease_id,
         desktop_lease_started_at = lease_started_at,
         desktop_lease_expires_at = lease_until,
         updated_at = lease_started_at
   where id = claimed_job_id
     and user_id = target_user_id;

  update public.ocr_worker_devices
     set last_seen_at = lease_started_at,
         updated_at = lease_started_at
   where id = target_device_id
     and user_id = target_user_id;

  return jsonb_build_object(
    'jobId', claimed_job_id,
    'pageId', claimed_page_id,
    'deviceId', target_device_id,
    'leaseId', target_lease_id,
    'leaseExpiresAt', lease_until
  );
end;
$$;

revoke execute on function public.claim_desktop_ocr_job(uuid, uuid, uuid, integer) from public;
revoke execute on function public.claim_desktop_ocr_job(uuid, uuid, uuid, integer) from anon;
revoke execute on function public.claim_desktop_ocr_job(uuid, uuid, uuid, integer) from authenticated;
grant execute on function public.claim_desktop_ocr_job(uuid, uuid, uuid, integer) to service_role;
