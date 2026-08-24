-- Public accounts have no desktop OCR capability. Keep this rule at the
-- database write and worker-auth boundaries as well as in the UI.

create or replace function public.prevent_public_desktop_ocr_route()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
begin
  if new.route::text = 'desktop'
    and new.user_id = current_user_id
    and not exists (
      select 1
        from public.app_users as app_user
       where app_user.user_id = current_user_id
         and app_user.is_active = true
         and app_user.provider_profile = 'owner'
    )
  then
    raise exception using
      errcode = '42501',
      message = 'Public accounts cannot use desktop OCR';
  end if;
  return new;
end;
$$;

drop trigger if exists prevent_public_desktop_ocr_job_route on public.ocr_jobs;
create trigger prevent_public_desktop_ocr_job_route
before insert or update of route on public.ocr_jobs
for each row execute function public.prevent_public_desktop_ocr_route();

drop trigger if exists prevent_public_desktop_ocr_batch_route on public.ocr_batches;
create trigger prevent_public_desktop_ocr_batch_route
before insert or update of route on public.ocr_batches
for each row execute function public.prevent_public_desktop_ocr_route();

revoke execute on function public.prevent_public_desktop_ocr_route() from public, anon, authenticated;
grant execute on function public.prevent_public_desktop_ocr_route() to service_role;

create or replace function public.create_ocr_worker_pairing_code()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  raw_code text;
  display_code text;
  expires_at_utc timestamptz := timezone('utc', now()) + interval '10 minutes';
  pairing_id uuid;
begin
  if current_user_id is null or not public.is_authorized_user() then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;
  if not exists (
    select 1
      from public.app_users as app_user
     where app_user.user_id = current_user_id
       and app_user.is_active = true
       and app_user.provider_profile = 'owner'
  ) then
    raise exception using errcode = '42501', message = 'Public accounts cannot use desktop OCR';
  end if;

  delete from public.ocr_worker_pairing_codes
   where user_id = current_user_id
     and consumed_at is null;

  raw_code := encode(extensions.gen_random_bytes(8), 'hex');
  display_code := upper(
    substr(raw_code, 1, 4) || '-' ||
    substr(raw_code, 5, 4) || '-' ||
    substr(raw_code, 9, 4) || '-' ||
    substr(raw_code, 13, 4)
  );

  insert into public.ocr_worker_pairing_codes (user_id, code_hash, expires_at)
  values (
    current_user_id,
    extensions.digest(convert_to(raw_code, 'UTF8'), 'sha256'),
    expires_at_utc
  )
  returning id into pairing_id;

  return jsonb_build_object(
    'pairingId', pairing_id,
    'code', display_code,
    'expiresAt', expires_at_utc
  );
end;
$$;

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
    or pg_column_size(device_capabilities) > 16384
  then
    raise exception using errcode = '22023', message = 'Invalid OCR worker device registration';
  end if;

  perform 1
    from public.app_users as app_user
   where app_user.user_id = target_user_id
     and app_user.is_active = true
     and app_user.provider_profile = 'owner';
  if not found then
    raise exception using errcode = '42501', message = 'User is not authorized for desktop OCR';
  end if;

  insert into public.ocr_worker_devices (
    user_id, label, credential_hash, status, capabilities
  ) values (
    target_user_id, normalized_label, decode(digest_hex, 'hex'), 'active', device_capabilities
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
    join public.app_users as app_user
      on app_user.user_id = device.user_id
     and app_user.is_active = true
     and app_user.provider_profile = 'owner'
   where device.credential_hash = decode(digest_hex, 'hex')
     and device.status = 'active';

  if not found then return null; end if;

  return jsonb_build_object(
    'deviceId', matched_device.id,
    'userId', matched_device.user_id,
    'label', matched_device.label,
    'capabilities', matched_device.capabilities,
    'lastSeenAt', matched_device.last_seen_at
  );
end;
$$;
