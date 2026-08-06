begin;

create extension if not exists pgtap with schema extensions;
select plan(5);

insert into auth.users (id, email)
values ('11111111-1111-4111-8111-111111111111', 'batch-transition@example.test');
insert into public.app_users (user_id, is_active, ocr_consent_at, ocr_consent_version)
values (
  '11111111-1111-4111-8111-111111111111', true, '2026-08-06T00:00:00Z', 1
);
insert into public.documents (
  id, user_id, title, kind, original_filename, storage_path, page_count, status
) values (
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  '11111111-1111-4111-8111-111111111111',
  'Transitions',
  'pdf',
  'transitions.pdf',
  '11111111-1111-4111-8111-111111111111/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/original.pdf',
  1,
  'processing'
);
insert into public.pages (id, user_id, document_id, page_number, status)
values (
  '10000000-0000-4000-8000-000000000001',
  '11111111-1111-4111-8111-111111111111',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  1,
  'pending'
);
insert into public.ocr_jobs (id, user_id, page_id, status, idempotency_key)
values (
  '30000000-0000-4000-8000-000000000001',
  '11111111-1111-4111-8111-111111111111',
  '10000000-0000-4000-8000-000000000001',
  'pending',
  'transition-page-1'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);

create temporary table transition_batch (id uuid not null);
insert into transition_batch (id)
select public.register_ocr_batch(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid,
  'gemini',
  array['10000000-0000-4000-8000-000000000001'::uuid],
  array[1],
  0,
  1024,
  0,
  null,
  'gemini-test',
  1,
  '2026-08-06T12:00:00Z'::timestamptz
);

select ok(
  public.record_ocr_batch_call(
    (select id from transition_batch), 1, '2026-08-06T12:00:01Z'::timestamptz
  ),
  'an active batch accepts one provider call'
);
select ok(
  public.finish_ocr_batch(
    (select id from transition_batch),
    'ready', null, null, null, '2026-08-06T12:00:02Z'::timestamptz
  ),
  'an active batch reaches ready'
);
select ok(
  public.finish_ocr_batch(
    (select id from transition_batch),
    'ready', null, null, null, '2026-08-06T12:00:03Z'::timestamptz
  ),
  'an exact terminal replay is idempotent'
);
select is(
  public.finish_ocr_batch(
    (select id from transition_batch),
    'failed', 'late_failure', 'Must not replace ready', null,
    '2026-08-06T12:00:04Z'::timestamptz
  ),
  false,
  'a terminal ready batch cannot be rewritten as failed'
);
select is(
  public.record_ocr_batch_call(
    (select id from transition_batch), 1, '2026-08-06T12:00:05Z'::timestamptz
  ),
  false,
  'a terminal batch cannot record another provider call'
);

select * from finish();
rollback;
