create or replace function public.rename_ocr_worker_device(
  target_device_id uuid,
  device_label text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  normalized_label text := btrim(device_label);
  device_row public.ocr_worker_devices%rowtype;
  updated_at_utc timestamptz := timezone('utc', now());
begin
  if current_user_id is null or not public.is_authorized_user() then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;

  if target_device_id is null
    or normalized_label is null
    or char_length(normalized_label) < 1
    or char_length(normalized_label) > 80 then
    raise exception using errcode = '22023', message = 'Invalid OCR worker device rename';
  end if;

  select device.*
    into device_row
    from public.ocr_worker_devices as device
   where device.id = target_device_id
     and device.user_id = current_user_id
   for update;

  if not found or device_row.status <> 'active' then
    raise exception using errcode = '55000', message = 'OCR worker device is unavailable';
  end if;

  if device_row.label = normalized_label then
    return jsonb_build_object(
      'deviceId', device_row.id,
      'label', device_row.label,
      'updatedAt', device_row.updated_at
    );
  end if;

  update public.ocr_worker_devices
     set label = normalized_label,
         updated_at = updated_at_utc
   where id = target_device_id
     and user_id = current_user_id
     and status = 'active'
  returning * into device_row;

  if not found then
    raise exception using errcode = '55000', message = 'OCR worker device is unavailable';
  end if;

  return jsonb_build_object(
    'deviceId', device_row.id,
    'label', device_row.label,
    'updatedAt', device_row.updated_at
  );
end;
$$;

revoke execute on function public.rename_ocr_worker_device(uuid, text) from public;
revoke execute on function public.rename_ocr_worker_device(uuid, text) from anon;
grant execute on function public.rename_ocr_worker_device(uuid, text) to authenticated;
grant execute on function public.rename_ocr_worker_device(uuid, text) to service_role;
