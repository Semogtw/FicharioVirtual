begin;

create extension if not exists pgtap with schema extensions;
select plan(8);

insert into auth.users (id, email)
values ('75555555-5555-4555-8555-555555555555', 'pair-code@example.test');

insert into public.app_users (user_id, is_active)
values ('75555555-5555-4555-8555-555555555555', true);

select ok(
  has_function_privilege(
    'authenticated',
    'public.create_ocr_worker_pairing_code()',
    'EXECUTE'
  ),
  'authenticated users can create an ephemeral pairing code'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.redeem_ocr_worker_pairing_code(text,text,text,jsonb)',
    'EXECUTE'
  ),
  'browser role cannot redeem pairing codes through the service-only boundary'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '75555555-5555-4555-8555-555555555555', true);

create temp table pairing_results (
  sequence integer primary key,
  payload jsonb not null
) on commit drop;

insert into pairing_results values (1, public.create_ocr_worker_pairing_code());

select ok(
  (select payload ->> 'code' from pairing_results where sequence = 1)
    ~ '^[0-9A-F]{4}(-[0-9A-F]{4}){3}$'
  and (select (payload ->> 'expiresAt')::timestamptz from pairing_results where sequence = 1)
    > timezone('utc', now()),
  'generated code is bounded, copyable and expires in the future'
);

insert into pairing_results values (2, public.create_ocr_worker_pairing_code());

reset role;

select throws_ok(
  format(
    'select public.redeem_ocr_worker_pairing_code(%L, %L, %L, %L::jsonb)',
    (select payload ->> 'code' from pairing_results where sequence = 1),
    'Desktop antigo',
    repeat('75', 32),
    '{"protocolVersion":1,"backend":"ollama","maxConcurrency":1}'
  ),
  '55000',
  'OCR worker pairing code is unavailable',
  'creating a new code invalidates the previous unused code for that owner'
);

select lives_ok(
  format(
    'select public.redeem_ocr_worker_pairing_code(%L, %L, %L, %L::jsonb)',
    (select payload ->> 'code' from pairing_results where sequence = 2),
    '  Desktop pareado  ',
    repeat('76', 32),
    '{"protocolVersion":1,"backend":"ollama","maxConcurrency":1}'
  ),
  'service boundary can redeem the current one-time code'
);

select results_eq(
  $$
    select
      device.user_id::text,
      device.label,
      encode(device.credential_hash, 'hex')
      from public.ocr_worker_devices as device
     where device.user_id = '75555555-5555-4555-8555-555555555555'
  $$,
  $$
    values (
      '75555555-5555-4555-8555-555555555555'::text,
      'Desktop pareado'::text,
      repeat('76', 32)::text
    )
  $$,
  'redemption binds the locally generated credential digest to the authenticated code owner'
);

select ok(
  exists (
    select 1
      from public.ocr_worker_pairing_codes
     where user_id = '75555555-5555-4555-8555-555555555555'
       and consumed_at is not null
       and device_id is not null
  ),
  'successful redemption marks the pairing code consumed and links the device'
);

select throws_ok(
  format(
    'select public.redeem_ocr_worker_pairing_code(%L, %L, %L, %L::jsonb)',
    (select payload ->> 'code' from pairing_results where sequence = 2),
    'Desktop repetido',
    repeat('77', 32),
    '{"protocolVersion":1,"backend":"ollama","maxConcurrency":1}'
  ),
  '55000',
  'OCR worker pairing code is unavailable',
  'a consumed pairing code cannot be replayed'
);

select * from finish();
rollback;
