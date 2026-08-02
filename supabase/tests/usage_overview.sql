begin;

create extension if not exists pgtap with schema extensions;
select plan(4);

insert into auth.users (id, email)
values ('77777777-7777-4777-8777-777777777777', 'usage-overview@example.test');

insert into public.app_users (user_id, is_active)
values ('77777777-7777-4777-8777-777777777777', true);

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
  '88888888-8888-4888-8888-888888888888',
  '77777777-7777-4777-8777-777777777777',
  'Usage overview fixture',
  'image',
  'usage.webp',
  '77777777-7777-4777-8777-777777777777/88888888-8888-4888-8888-888888888888/original.webp',
  1,
  'pending'
);

insert into public.pages (
  id,
  user_id,
  document_id,
  page_number,
  status
) values (
  '99999999-9999-4999-8999-999999999999',
  '77777777-7777-4777-8777-777777777777',
  '88888888-8888-4888-8888-888888888888',
  1,
  'pending'
);

insert into public.usage_daily (
  user_id,
  usage_date,
  ocr_pages,
  quota_errors
) values (
  '77777777-7777-4777-8777-777777777777',
  (timezone('utc', now()))::date,
  2,
  1
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '77777777-7777-4777-8777-777777777777', true);

select lives_ok(
  $$ select public.get_usage_overview() $$,
  'usage overview executes against processing_status values'
);

select is(
  public.get_usage_overview()->'today'->>'ocrPages',
  '2',
  'today uses the UTC usage counter'
);

select is(
  public.get_usage_overview()->'today'->>'quotaErrors',
  '1',
  'today exposes quota errors'
);

select is(
  public.get_usage_overview()->'totals'->>'pendingPages',
  '1',
  'pending page total uses valid processing statuses'
);

select * from finish();
rollback;
