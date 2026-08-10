begin;

create extension if not exists pgtap with schema extensions;
select plan(7);

insert into auth.users (id, email)
values
  ('71111111-1111-4111-8111-111111111111', 'rename-owner@example.test'),
  ('72222222-2222-4222-8222-222222222222', 'rename-other@example.test');

insert into public.app_users (user_id, is_active)
values
  ('71111111-1111-4111-8111-111111111111', true),
  ('72222222-2222-4222-8222-222222222222', true);

insert into public.ocr_worker_devices (
  id,
  user_id,
  label,
  credential_hash,
  status,
  capabilities
) values
  (
    '73333333-3333-4333-8333-333333333333',
    '71111111-1111-4111-8111-111111111111',
    'Desktop antigo',
    decode(repeat('71', 32), 'hex'),
    'active',
    '{"protocolVersion":1,"backend":"ollama","maxConcurrency":1}'::jsonb
  ),
  (
    '74444444-4444-4444-8444-444444444444',
    '72222222-2222-4222-8222-222222222222',
    'Desktop de outro usuário',
    decode(repeat('72', 32), 'hex'),
    'active',
    '{"protocolVersion":1,"backend":"ollama","maxConcurrency":1}'::jsonb
  );

select ok(
  has_function_privilege(
    'authenticated',
    'public.rename_ocr_worker_device(uuid,text)',
    'EXECUTE'
  ),
  'authenticated users can call the bounded rename RPC'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.rename_ocr_worker_device(uuid,text)',
    'EXECUTE'
  ),
  'anonymous users cannot call the device rename RPC'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '71111111-1111-4111-8111-111111111111', true);

select lives_ok(
  $$
    select public.rename_ocr_worker_device(
      '73333333-3333-4333-8333-333333333333',
      '  Desktop principal  '
    )
  $$,
  'device owner can rename an active desktop OCR worker'
);

select results_eq(
  $$
    select label
      from public.list_ocr_worker_devices()
     where device_id = '73333333-3333-4333-8333-333333333333'
  $$,
  $$ values ('Desktop principal'::text) $$,
  'rename normalizes surrounding whitespace before persisting the label'
);

select throws_ok(
  $$
    select public.rename_ocr_worker_device(
      '74444444-4444-4444-8444-444444444444',
      'Tentativa indevida'
    )
  $$,
  '55000',
  'OCR worker device is unavailable',
  'an owner cannot rename another user device'
);

select throws_ok(
  $$
    select public.rename_ocr_worker_device(
      '73333333-3333-4333-8333-333333333333',
      '   '
    )
  $$,
  '22023',
  'Invalid OCR worker device rename',
  'blank normalized labels are rejected'
);

select public.revoke_ocr_worker_device('73333333-3333-4333-8333-333333333333');

select throws_ok(
  $$
    select public.rename_ocr_worker_device(
      '73333333-3333-4333-8333-333333333333',
      'Nome depois da revogação'
    )
  $$,
  '55000',
  'OCR worker device is unavailable',
  'revoked devices are immutable through the rename RPC'
);

select * from finish();
rollback;
