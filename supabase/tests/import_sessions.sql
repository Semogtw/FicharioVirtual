begin;

create extension if not exists pgtap with schema extensions;
select plan(9);

insert into auth.users (id, email)
values
  ('11111111-1111-4111-8111-111111111111', 'resume-owner@example.test'),
  ('22222222-2222-4222-8222-222222222222', 'resume-other@example.test');

insert into public.app_users (user_id, is_active)
values
  ('11111111-1111-4111-8111-111111111111', true),
  ('22222222-2222-4222-8222-222222222222', true);

set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);

select lives_ok(
  $$
    insert into public.import_sessions (
      id,
      user_id,
      status,
      total_items,
      prepared_items,
      uploaded_items,
      completed_items,
      local_resume_key
    ) values (
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      '11111111-1111-4111-8111-111111111111',
      'uploading',
      1,
      1,
      0,
      0,
      'resume-key-shared-0001'
    )
  $$,
  'owner can create a resumable import session'
);

select throws_ok(
  $$
    insert into public.import_sessions (user_id, total_items, local_resume_key)
    values (
      '11111111-1111-4111-8111-111111111111',
      1,
      'resume-key-shared-0001'
    )
  $$,
  '23505',
  null,
  'the same owner cannot duplicate a resume key'
);

select throws_ok(
  $$
    insert into public.import_sessions (
      user_id,
      status,
      total_items,
      prepared_items,
      uploaded_items,
      completed_items,
      local_resume_key
    ) values (
      '11111111-1111-4111-8111-111111111111',
      'uploading',
      1,
      0,
      1,
      0,
      'resume-key-invalid-progress'
    )
  $$,
  '23514',
  null,
  'uploaded progress cannot exceed prepared progress'
);

select throws_ok(
  $$
    insert into public.import_sessions (
      user_id,
      status,
      total_items,
      prepared_items,
      uploaded_items,
      completed_items,
      local_resume_key
    ) values (
      '11111111-1111-4111-8111-111111111111',
      'completed',
      1,
      1,
      1,
      1,
      'resume-key-missing-finish'
    )
  $$,
  '23514',
  null,
  'completed sessions require a finish timestamp'
);

select throws_ok(
  $$
    insert into public.import_sessions (
      user_id,
      status,
      total_items,
      local_resume_key,
      finished_at
    ) values (
      '11111111-1111-4111-8111-111111111111',
      'draft',
      1,
      'resume-key-premature-finish',
      timezone('utc', now())
    )
  $$,
  '23514',
  null,
  'active sessions cannot claim a finish timestamp'
);

select throws_ok(
  $$
    insert into public.import_sessions (user_id, total_items, local_resume_key)
    values (
      '11111111-1111-4111-8111-111111111111',
      1,
      E'resume-key-with-newline\n'
    )
  $$,
  '23514',
  null,
  'resume keys reject control characters'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);

select is_empty(
  $$
    select id
    from public.import_sessions
    where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  $$,
  'another owner cannot read a resumable import session'
);

select results_eq(
  $$
    with changed as (
      update public.import_sessions
      set status = 'failed', last_error_code = 'stolen'
      where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
      returning id
    )
    select count(*)::bigint from changed
  $$,
  $$ values (0::bigint) $$,
  'another owner cannot update a resumable import session'
);

select lives_ok(
  $$
    insert into public.import_sessions (user_id, total_items, local_resume_key)
    values (
      '22222222-2222-4222-8222-222222222222',
      1,
      'resume-key-shared-0001'
    )
  $$,
  'different owners may use the same local resume key'
);

select * from finish();
rollback;
