create or replace function public.delete_ocr_worker_device(
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
  deleted_pairing_codes integer := 0;
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

  if device_row.status <> 'revoked' then
    raise exception using errcode = '55000', message = 'OCR worker device must be revoked before deletion';
  end if;

  with removed as (
    delete from public.ocr_worker_pairing_codes
     where user_id = current_user_id
       and device_id = target_device_id
    returning id
  )
  select count(*)::integer into deleted_pairing_codes from removed;

  delete from public.ocr_worker_devices
   where id = target_device_id
     and user_id = current_user_id
     and status = 'revoked';

  if not found then
    raise exception using errcode = '55000', message = 'OCR worker device is unavailable';
  end if;

  return jsonb_build_object(
    'deviceId', target_device_id,
    'deleted', true,
    'pairingCodesDeleted', deleted_pairing_codes
  );
end;
$$;

revoke execute on function public.delete_ocr_worker_device(uuid) from public;
revoke execute on function public.delete_ocr_worker_device(uuid) from anon;
grant execute on function public.delete_ocr_worker_device(uuid) to authenticated;
grant execute on function public.delete_ocr_worker_device(uuid) to service_role;
