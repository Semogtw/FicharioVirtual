create table public.ocr_worker_pairing_codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  code_hash bytea not null unique check (octet_length(code_hash) = 32),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  device_id uuid references public.ocr_worker_devices(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  constraint ocr_worker_pairing_codes_expiry check (expires_at > created_at),
  constraint ocr_worker_pairing_codes_consumed_shape check (
    (consumed_at is null and device_id is null)
    or (consumed_at is not null and device_id is not null)
  )
);

create index ocr_worker_pairing_codes_owner_created_idx
  on public.ocr_worker_pairing_codes (user_id, created_at desc, id);

create index ocr_worker_pairing_codes_expiry_idx
  on public.ocr_worker_pairing_codes (expires_at)
  where consumed_at is null;

alter table public.ocr_worker_pairing_codes enable row level security;

revoke all on table public.ocr_worker_pairing_codes from public, anon, authenticated;
grant all on table public.ocr_worker_pairing_codes to service_role;

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

  insert into public.ocr_worker_pairing_codes (
    user_id,
    code_hash,
    expires_at
  ) values (
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

create or replace function public.redeem_ocr_worker_pairing_code(
  pairing_code text,
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
  normalized_code text := lower(replace(pairing_code, '-', ''));
  normalized_label text := btrim(device_label);
  pairing_row public.ocr_worker_pairing_codes%rowtype;
  registered jsonb;
  registered_device_id uuid;
  consumed_at_utc timestamptz := timezone('utc', now());
begin
  if pairing_code is null
    or pairing_code !~ '^[0-9A-Fa-f]{4}(-[0-9A-Fa-f]{4}){3}$'
    or normalized_code !~ '^[0-9a-f]{16}$'
    or normalized_label is null
    or char_length(normalized_label) < 1
    or char_length(normalized_label) > 80
    or normalized_label ~ '[[:cntrl:]]'
    or digest_hex is null
    or digest_hex !~ '^[0-9a-f]{64}$'
    or device_capabilities is null
    or jsonb_typeof(device_capabilities) <> 'object'
    or pg_column_size(device_capabilities) > 16384 then
    raise exception using errcode = '22023', message = 'Invalid OCR worker pairing redemption';
  end if;

  select pairing.*
    into pairing_row
    from public.ocr_worker_pairing_codes as pairing
   where pairing.code_hash = extensions.digest(convert_to(normalized_code, 'UTF8'), 'sha256')
   for update;

  if not found
    or pairing_row.consumed_at is not null
    or pairing_row.expires_at <= consumed_at_utc then
    raise exception using errcode = '55000', message = 'OCR worker pairing code is unavailable';
  end if;

  registered := public.register_ocr_worker_device(
    pairing_row.user_id,
    normalized_label,
    digest_hex,
    device_capabilities
  );

  registered_device_id := nullif(registered ->> 'deviceId', '')::uuid;
  if registered_device_id is null then
    raise exception using errcode = '55000', message = 'OCR worker pairing registration failed';
  end if;

  update public.ocr_worker_pairing_codes
     set consumed_at = consumed_at_utc,
         device_id = registered_device_id
   where id = pairing_row.id;

  return registered;
end;
$$;

revoke execute on function public.create_ocr_worker_pairing_code() from public;
revoke execute on function public.create_ocr_worker_pairing_code() from anon;
grant execute on function public.create_ocr_worker_pairing_code() to authenticated;
grant execute on function public.create_ocr_worker_pairing_code() to service_role;

revoke execute on function public.redeem_ocr_worker_pairing_code(text, text, text, jsonb) from public;
revoke execute on function public.redeem_ocr_worker_pairing_code(text, text, text, jsonb) from anon;
revoke execute on function public.redeem_ocr_worker_pairing_code(text, text, text, jsonb) from authenticated;
grant execute on function public.redeem_ocr_worker_pairing_code(text, text, text, jsonb) to service_role;
