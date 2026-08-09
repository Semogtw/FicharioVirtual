alter table public.ocr_jobs
  add column desktop_lease_device_id uuid,
  add column desktop_lease_id uuid,
  add column desktop_lease_expires_at timestamptz,
  add column desktop_lease_started_at timestamptz;

alter table public.ocr_jobs
  add constraint desktop_ocr_lease_shape check (
    (
      desktop_lease_device_id is null
      and desktop_lease_id is null
      and desktop_lease_expires_at is null
      and desktop_lease_started_at is null
    )
    or (
      desktop_lease_device_id is not null
      and desktop_lease_id is not null
      and desktop_lease_expires_at is not null
      and desktop_lease_started_at is not null
      and desktop_lease_expires_at > desktop_lease_started_at
    )
  ),
  add constraint desktop_ocr_lease_device_owner_fkey
    foreign key (desktop_lease_device_id, user_id)
    references public.ocr_worker_devices(id, user_id),
  add constraint desktop_ocr_waiting_route_shape check (
    status <> 'waiting_desktop'::public.ocr_status
    or route = 'desktop'::public.ocr_route
  ),
  add constraint desktop_ocr_gemini_has_no_lease check (
    route <> 'gemini'::public.ocr_route
    or desktop_lease_device_id is null
  ),
  add constraint desktop_ocr_waiting_has_no_lease check (
    status <> 'waiting_desktop'::public.ocr_status
    or desktop_lease_device_id is null
  ),
  add constraint desktop_ocr_processing_lease_shape check (
    route <> 'desktop'::public.ocr_route
    or status <> 'processing'::public.ocr_status
    or desktop_lease_device_id is not null
  );

create index ocr_jobs_desktop_claim_idx
  on public.ocr_jobs (user_id, created_at, id)
  where route = 'desktop'::public.ocr_route
    and status = 'waiting_desktop'::public.ocr_status;

create index ocr_jobs_desktop_lease_expiry_idx
  on public.ocr_jobs (desktop_lease_expires_at, id)
  where desktop_lease_expires_at is not null;

create or replace function public.set_ocr_job_route(
  target_page_id uuid,
  target_route public.ocr_route
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  current_job public.ocr_jobs%rowtype;
  next_status public.ocr_status;
begin
  if current_user_id is null or not public.is_authorized_user() then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;

  if target_page_id is null or target_route is null then
    raise exception using errcode = '22023', message = 'Invalid OCR route request';
  end if;

  select job.*
    into current_job
    from public.ocr_jobs as job
   where job.page_id = target_page_id
     and job.user_id = current_user_id
   for update;

  if not found then
    raise exception using errcode = '55000', message = 'OCR job is unavailable for route change';
  end if;

  if current_job.route = target_route then
    return jsonb_build_object(
      'jobId', current_job.id,
      'pageId', current_job.page_id,
      'route', current_job.route,
      'status', current_job.status
    );
  end if;

  if current_job.desktop_lease_id is not null then
    raise exception using errcode = '55P03', message = 'OCR job has an active desktop lease';
  end if;

  if target_route = 'desktop'::public.ocr_route
    and current_job.route = 'gemini'::public.ocr_route
    and current_job.status = 'queued'::public.ocr_status then
    next_status := 'waiting_desktop'::public.ocr_status;
  elsif target_route = 'gemini'::public.ocr_route
    and current_job.route = 'desktop'::public.ocr_route
    and current_job.status = 'waiting_desktop'::public.ocr_status then
    next_status := 'queued'::public.ocr_status;
  else
    raise exception using errcode = '55000', message = 'OCR job cannot change route in its current state';
  end if;

  update public.ocr_jobs
     set route = target_route,
         status = next_status,
         updated_at = timezone('utc', now())
   where id = current_job.id
     and user_id = current_user_id;

  return jsonb_build_object(
    'jobId', current_job.id,
    'pageId', current_job.page_id,
    'route', target_route,
    'status', next_status
  );
end;
$$;

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
  renewed_job_id uuid;
  renewed_page_id uuid;
  renewed_user_id uuid;
  renewed_until timestamptz := timezone('utc', now()) + make_interval(secs => lease_seconds);
begin
  if target_job_id is null
    or target_device_id is null
    or target_lease_id is null
    or lease_seconds is null
    or lease_seconds < 30
    or lease_seconds > 900 then
    raise exception using errcode = '22023', message = 'Invalid desktop OCR lease renewal';
  end if;

  update public.ocr_jobs as job
     set desktop_lease_expires_at = renewed_until,
         updated_at = timezone('utc', now())
    from public.ocr_worker_devices as device
   where job.id = target_job_id
     and job.desktop_lease_device_id = target_device_id
     and job.desktop_lease_id = target_lease_id
     and job.desktop_lease_expires_at > timezone('utc', now())
     and job.route = 'desktop'::public.ocr_route
     and job.status = 'processing'::public.ocr_status
     and device.id = target_device_id
     and device.user_id = job.user_id
     and device.status = 'active'
  returning job.id, job.page_id, job.user_id
       into renewed_job_id, renewed_page_id, renewed_user_id;

  if not found then
    raise exception using errcode = '55P03', message = 'Desktop OCR lease is not active';
  end if;

  update public.ocr_worker_devices
     set last_seen_at = timezone('utc', now()),
         updated_at = timezone('utc', now())
   where id = target_device_id
     and user_id = renewed_user_id;

  return jsonb_build_object(
    'jobId', renewed_job_id,
    'pageId', renewed_page_id,
    'deviceId', target_device_id,
    'leaseId', target_lease_id,
    'leaseExpiresAt', renewed_until
  );
end;
$$;

create or replace function public.expire_desktop_ocr_job_leases()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  expired_count integer;
begin
  with expired as (
    update public.ocr_jobs
       set status = 'waiting_desktop'::public.ocr_status,
           desktop_lease_device_id = null,
           desktop_lease_id = null,
           desktop_lease_expires_at = null,
           desktop_lease_started_at = null,
           updated_at = timezone('utc', now())
     where route = 'desktop'::public.ocr_route
       and status = 'processing'::public.ocr_status
       and desktop_lease_expires_at <= timezone('utc', now())
    returning id
  )
  select count(*)::integer into expired_count from expired;

  return expired_count;
end;
$$;

revoke execute on function public.set_ocr_job_route(uuid, public.ocr_route) from public;
revoke execute on function public.set_ocr_job_route(uuid, public.ocr_route) from anon;
grant execute on function public.set_ocr_job_route(uuid, public.ocr_route) to authenticated;
grant execute on function public.set_ocr_job_route(uuid, public.ocr_route) to service_role;

revoke execute on function public.claim_desktop_ocr_job(uuid, uuid, uuid, integer) from public;
revoke execute on function public.claim_desktop_ocr_job(uuid, uuid, uuid, integer) from anon;
revoke execute on function public.claim_desktop_ocr_job(uuid, uuid, uuid, integer) from authenticated;
grant execute on function public.claim_desktop_ocr_job(uuid, uuid, uuid, integer) to service_role;

revoke execute on function public.renew_desktop_ocr_job_lease(uuid, uuid, uuid, integer) from public;
revoke execute on function public.renew_desktop_ocr_job_lease(uuid, uuid, uuid, integer) from anon;
revoke execute on function public.renew_desktop_ocr_job_lease(uuid, uuid, uuid, integer) from authenticated;
grant execute on function public.renew_desktop_ocr_job_lease(uuid, uuid, uuid, integer) to service_role;

revoke execute on function public.expire_desktop_ocr_job_leases() from public;
revoke execute on function public.expire_desktop_ocr_job_leases() from anon;
revoke execute on function public.expire_desktop_ocr_job_leases() from authenticated;
grant execute on function public.expire_desktop_ocr_job_leases() to service_role;
