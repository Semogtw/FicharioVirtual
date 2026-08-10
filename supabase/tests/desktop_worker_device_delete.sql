begin;

create extension if not exists pgtap with schema extensions;
select plan(9);

insert into auth.users (id, email)
values
  ('81111111-1111-4111-8111-111111111111', 'delete-owner@example.test'),
  ('82222222-2222-4222-8222-222222222222', 'delete-other@example.test');

insert into public.app_users (user_id, is_active)
values
  ('81111111-1111-4111-8111-111111111111', true),
  ('82222222-2222-4222-8222-222222222222', true);

insert into public.ocr_worker_devices (
  id,
  user_id,
  label,
  credential_hash,
  status,
  capabilities
) values
  (
    '83333333-3333-4333-8333-333333333333',
    '81111111-1111-4111-8111-111111111111',
    'Desktop removível',
    decode(repeat('81', 32), 'hex'),
    'active',
    '{"protocolVersion":1,"backend":"ollama","maxConcurrency":1}'::jsonb
  ),
  (
    '84444444-4444-4444-8444-444444444444',
    '82222222-2222-4222-8222-222222222222',
    'Desktop de outro usuário',
    decode(repeat('82', 32), 'hex'),
    'active',
    '{"protocolVersion":1,"backend":"ollama","maxConcurrency":1}'::jsonb
  );

insert into public.ocr_worker_pairing_codes (
  id,
  user_id,
  code_hash,
  expires_at,
  consumed_at,
  device_id
) values (
  '85555555-5555-4555-8555-555555555555',
  '81111111-1111-4111-8111-111111111111',
  decode(repeat('83', 32), 'hex'),
  timezone('utc', now()) + interval '10 minutes',
  timezone('utc', now()),
  '83333333-3333-4333-8333-333333333333'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.delete_ocr_worker_device(uuid)',
    'EXECUTE'
  ),
  'authenticated users can call the bounded delete RPC'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.delete_ocr_worker_device(uuid)',
    'EXECUTE'
  ),
  'anonymous users cannot call the device delete RPC'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '81111111-1111-4111-8111-111111111111', true);

select throws_ok(
  $$ select public.delete_ocr_worker_device('83333333-3333-4333-8333-333333333333') $$,
  '55000',
  'OCR worker device must be revoked before deletion',
  'an active device cannot be deleted before explicit revocation'
);

select throws_ok(
  $$ select public.delete_ocr_worker_device('84444444-4444-4444-8444-444444444444') $$,
  '55000',
  'OCR worker device is unavailable',
  'an owner cannot delete another user device'
);

select public.revoke_ocr_worker_device('83333333-3333-4333-8333-333333333333');

select lives_ok(
  $$ select public.delete_ocr_worker_device('83333333-3333-4333-8333-333333333333') $$,
  'a revoked device can be deleted by its owner'
);

select is(
  (select count(*)::integer from public.list_ocr_worker_devices()),
  0,
  'the deleted device disappears from the owner device list'
);

select throws_ok(
  $$ select public.delete_ocr_worker_device('83333333-3333-4333-8333-333333333333') $$,
  '55000',
  'OCR worker device is unavailable',
  'deleting the same device again fails closed'
);

reset role;

select is(
  (select count(*)::integer from public.ocr_worker_pairing_codes where id = '85555555-5555-4555-8555-555555555555'),
  0,
  'consumed pairing records are deleted before the device to preserve pairing constraints'
);

select is(
  (select count(*)::integer from public.ocr_worker_devices where id = '84444444-4444-4444-8444-444444444444'),
  1,
  'another user device remains untouched'
);

select * from finish();
rollback;
