begin;

create extension if not exists pgtap with schema extensions;
select plan(2);

select ok(
  position(
    'timezone(''utc'', now())'
    in lower(pg_get_functiondef('public.export_portable_manifest()'::regprocedure))
  ) = 0,
  'portable export keeps exportedAt as timestamptz instead of stripping its offset'
);

select like(
  (jsonb_build_object('exportedAt', now())->>'exportedAt'),
  '%+00:00',
  'timestamptz JSON serialization carries an RFC3339 UTC offset'
);

select * from finish();
rollback;
