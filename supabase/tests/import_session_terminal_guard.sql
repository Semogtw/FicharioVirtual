begin;

create extension if not exists pgtap with schema extensions;
select plan(5);

insert into auth.users (id, email)
values ('aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', 'import-guard@example.test');

insert into public.app_users (user_id, is_active)
values ('aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', true);

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
  'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb',
  'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa',
  'draft',
  1,
  0,
  0,
  0,
  'terminal-guard-resume-key'
);

select lives_ok(
  $$
    update public.import_sessions
    set status = 'processing',
        prepared_items = 1,
        uploaded_items = 1
    where id = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb'
  $$,
  'import progress can advance'
);

select throws_ok(
  $$
    update public.import_sessions
    set uploaded_items = 0
    where id = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb'
  $$,
  '23514',
  'import session progress cannot regress',
  'import counters cannot regress'
);

update public.import_sessions
set status = 'completed',
    completed_items = 1,
    finished_at = '2026-08-04T19:00:00Z'
where id = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';

select throws_ok(
  $$
    update public.import_sessions
    set status = 'draft',
        prepared_items = 0,
        uploaded_items = 0,
        completed_items = 0,
        finished_at = null
    where id = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb'
  $$,
  '23514',
  'terminal import session cannot regress',
  'completed import sessions cannot return to an active state'
);

select lives_ok(
  $$
    update public.import_sessions
    set status = 'completed',
        total_items = 1,
        prepared_items = 1,
        uploaded_items = 1,
        completed_items = 1,
        finished_at = '2026-08-04T20:00:00Z'
    where id = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb'
  $$,
  'idempotent terminal updates remain accepted'
);

select is(
  (
    select finished_at
    from public.import_sessions
    where id = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb'
  ),
  '2026-08-04T19:00:00Z'::timestamptz,
  'the original terminal timestamp is preserved'
);

select * from finish();
rollback;
