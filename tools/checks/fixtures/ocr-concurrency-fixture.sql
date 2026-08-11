\set ON_ERROR_STOP on

begin;

delete from public.document_tags
where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid;
delete from public.tags
where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid;
delete from public.usage_daily
where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid;
delete from public.ocr_jobs
where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid;
delete from public.pages
where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid;
delete from public.documents
where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid;
delete from public.notebooks
where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid;
delete from public.app_users
where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid;
delete from auth.users
where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid;

insert into auth.users (id, email)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'ocr-gate@example.test');

insert into public.app_users (user_id, is_active)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true);

insert into public.documents (
  id,
  user_id,
  title,
  kind,
  original_filename,
  storage_path,
  page_count,
  status
) values (
  '11111111-1111-4111-8111-111111111111',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'OCR concurrency fixture',
  'image',
  'fixture.webp',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/11111111-1111-4111-8111-111111111111/original.webp',
  2,
  'pending'
);

insert into public.pages (
  id,
  user_id,
  document_id,
  page_number,
  status
) values
  (
    '22222222-2222-4222-8222-222222222222',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '11111111-1111-4111-8111-111111111111',
    1,
    'pending'
  ),
  (
    '55555555-5555-4555-8555-555555555555',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '11111111-1111-4111-8111-111111111111',
    2,
    'pending'
  );

insert into public.ocr_jobs (
  id,
  user_id,
  page_id,
  provider,
  prompt_version,
  status,
  idempotency_key
) values
  (
    '33333333-3333-4333-8333-333333333333',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '22222222-2222-4222-8222-222222222222',
    'gemini',
    1,
    'pending',
    'ocr:22222222-2222-4222-8222-222222222222:v1'
  ),
  (
    '66666666-6666-4666-8666-666666666666',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '55555555-5555-4555-8555-555555555555',
    'gemini',
    1,
    'pending',
    'ocr:55555555-5555-4555-8555-555555555555:v1'
  );

commit;
