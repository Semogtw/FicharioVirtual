create or replace function public.register_ocr_worker_device(
  target_user_id uuid,
  device_label text,
  digest_hex text,
  device_capabilities jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_label text := btrim(device_label);
  created_device public.ocr_worker_devices%rowtype;
begin
  if target_user_id is null
    or normalized_label is null
    or char_length(normalized_label) < 1
    or char_length(normalized_label) > 80
    or digest_hex is null
    or digest_hex !~ '^[0-9a-f]{64}$'
    or device_capabilities is null
    or jsonb_typeof(device_capabilities) <> 'object'
    or pg_column_size(device_capabilities) > 16384 then
    raise exception using errcode = '22023', message = 'Invalid OCR worker device registration';
  end if;

  perform 1
    from public.app_users
   where user_id = target_user_id
     and is_active = true;

  if not found then
    raise exception using errcode = '42501', message = 'User is not authorized';
  end if;

  insert into public.ocr_worker_devices (
    user_id,
    label,
    credential_hash,
    status,
    capabilities
  ) values (
    target_user_id,
    normalized_label,
    decode(digest_hex, 'hex'),
    'active',
    device_capabilities
  )
  returning * into created_device;

  return jsonb_build_object(
    'deviceId', created_device.id,
    'userId', created_device.user_id,
    'label', created_device.label,
    'status', created_device.status,
    'capabilities', created_device.capabilities,
    'createdAt', created_device.created_at
  );
end;
$$;

create or replace function public.authenticate_ocr_worker_device(
  digest_hex text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  matched_device public.ocr_worker_devices%rowtype;
begin
  if digest_hex is null or digest_hex !~ '^[0-9a-f]{64}$' then
    return null;
  end if;

  select device.*
    into matched_device
    from public.ocr_worker_devices as device
   where device.credential_hash = decode(digest_hex, 'hex')
     and device.status = 'active';

  if not found then
    return null;
  end if;

  return jsonb_build_object(
    'deviceId', matched_device.id,
    'userId', matched_device.user_id,
    'label', matched_device.label,
    'capabilities', matched_device.capabilities,
    'lastSeenAt', matched_device.last_seen_at
  );
end;
$$;

create or replace function public.revoke_ocr_worker_device(
  target_device_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  device_row public.ocr_worker_devices%rowtype;
  revoked_at_utc timestamptz := timezone('utc', now());
  requeued_count integer;
begin
  if current_user_id is null or not public.is_authorized_user() then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;

  if target_device_id is null then
    raise exception using errcode = '22023', message = 'Invalid OCR worker device id';
  end if;

  select device.*
    into device_row
    from public.ocr_worker_devices as device
   where device.id = target_device_id
     and device.user_id = current_user_id
   for update;

  if not found then
    raise exception using errcode = '55000', message = 'OCR worker device is unavailable';
  end if;

  if device_row.status = 'revoked' then
    return jsonb_build_object(
      'deviceId', device_row.id,
      'status', device_row.status,
      'revokedAt', device_row.revoked_at,
      'requeuedJobs', 0
    );
  end if;

  update public.ocr_worker_devices
     set status = 'revoked',
         revoked_at = revoked_at_utc,
         updated_at = revoked_at_utc
   where id = target_device_id
     and user_id = current_user_id;

  with requeued as (
    update public.ocr_jobs
       set status = 'waiting_desktop'::public.ocr_status,
           desktop_lease_device_id = null,
           desktop_lease_id = null,
           desktop_lease_expires_at = null,
           desktop_lease_started_at = null,
           updated_at = revoked_at_utc
     where user_id = current_user_id
       and route = 'desktop'::public.ocr_route
       and status = 'processing'::public.ocr_status
       and desktop_lease_device_id = target_device_id
    returning id
  )
  select count(*)::integer into requeued_count from requeued;

  return jsonb_build_object(
    'deviceId', target_device_id,
    'status', 'revoked',
    'revokedAt', revoked_at_utc,
    'requeuedJobs', requeued_count
  );
end;
$$;

create or replace function public.get_desktop_ocr_job_source(
  target_job_id uuid,
  target_device_id uuid,
  target_lease_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  source_record record;
begin
  if target_job_id is null or target_device_id is null or target_lease_id is null then
    raise exception using errcode = '22023', message = 'Invalid desktop OCR source request';
  end if;

  select
    job.id as job_id,
    job.user_id,
    page.id as page_id,
    page.document_id,
    page.page_number,
    page.storage_path,
    job.desktop_lease_expires_at
    into source_record
    from public.ocr_jobs as job
    join public.pages as page
      on page.id = job.page_id
     and page.user_id = job.user_id
    join public.ocr_worker_devices as device
      on device.id = job.desktop_lease_device_id
     and device.user_id = job.user_id
   where job.id = target_job_id
     and job.desktop_lease_device_id = target_device_id
     and job.desktop_lease_id = target_lease_id
     and job.desktop_lease_expires_at > timezone('utc', now())
     and job.route = 'desktop'::public.ocr_route
     and job.status = 'processing'::public.ocr_status
     and device.status = 'active'
     and page.storage_path is not null;

  if not found then
    raise exception using errcode = '55P03', message = 'Desktop OCR source lease is not active';
  end if;

  return jsonb_build_object(
    'jobId', source_record.job_id,
    'userId', source_record.user_id,
    'pageId', source_record.page_id,
    'documentId', source_record.document_id,
    'pageNumber', source_record.page_number,
    'storagePath', source_record.storage_path,
    'leaseExpiresAt', source_record.desktop_lease_expires_at
  );
end;
$$;

revoke execute on function public.register_ocr_worker_device(uuid, text, text, jsonb) from public;
revoke execute on function public.register_ocr_worker_device(uuid, text, text, jsonb) from anon;
revoke execute on function public.register_ocr_worker_device(uuid, text, text, jsonb) from authenticated;
grant execute on function public.register_ocr_worker_device(uuid, text, text, jsonb) to service_role;

revoke execute on function public.authenticate_ocr_worker_device(text) from public;
revoke execute on function public.authenticate_ocr_worker_device(text) from anon;
revoke execute on function public.authenticate_ocr_worker_device(text) from authenticated;
grant execute on function public.authenticate_ocr_worker_device(text) to service_role;

revoke execute on function public.revoke_ocr_worker_device(uuid) from public;
revoke execute on function public.revoke_ocr_worker_device(uuid) from anon;
grant execute on function public.revoke_ocr_worker_device(uuid) to authenticated;
grant execute on function public.revoke_ocr_worker_device(uuid) to service_role;

revoke execute on function public.get_desktop_ocr_job_source(uuid, uuid, uuid) from public;
revoke execute on function public.get_desktop_ocr_job_source(uuid, uuid, uuid) from anon;
revoke execute on function public.get_desktop_ocr_job_source(uuid, uuid, uuid) from authenticated;
grant execute on function public.get_desktop_ocr_job_source(uuid, uuid, uuid) to service_role;
