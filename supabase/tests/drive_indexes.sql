begin;

create extension if not exists pgtap with schema extensions;
select plan(6);

select is(
  (
    select count(*)
    from pg_indexes
    where schemaname = 'public'
      and indexname = 'notebooks_parent_owner_idx'
  ),
  1::bigint,
  'nested notebook foreign key has a covering index'
);

select is(
  (
    select count(*)
    from pg_indexes
    where schemaname = 'public'
      and indexname = 'drive_sync_jobs_document_owner_idx'
  ),
  1::bigint,
  'Drive job document foreign key has a covering index'
);

select is(
  (
    select count(*)
    from pg_indexes
    where schemaname = 'public'
      and indexname = 'drive_sync_jobs_notebook_owner_idx'
  ),
  1::bigint,
  'Drive job notebook foreign key has a covering index'
);

select is(
  (
    select count(*)
    from pg_indexes
    where schemaname = 'public'
      and indexname = 'drive_conflicts_job_owner_idx'
  ),
  1::bigint,
  'Drive conflict job foreign key has a covering index'
);

select is(
  (
    select count(*)
    from pg_indexes
    where schemaname = 'public'
      and indexname = 'drive_conflicts_document_owner_idx'
  ),
  1::bigint,
  'Drive conflict document foreign key has a covering index'
);

select is(
  (
    select count(*)
    from pg_indexes
    where schemaname = 'public'
      and indexname = 'drive_conflicts_notebook_owner_idx'
  ),
  1::bigint,
  'Drive conflict notebook foreign key has a covering index'
);

select * from finish();
rollback;
