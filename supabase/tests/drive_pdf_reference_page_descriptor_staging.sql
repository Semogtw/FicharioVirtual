begin;

select plan(12);

select ok(
  to_regclass('public.drive_pdf_reference_page_descriptors') is not null,
  'drive PDF descriptor staging table exists'
);

select ok(
  coalesce((
    select relrowsecurity
      from pg_class
     where oid = 'public.drive_pdf_reference_page_descriptors'::regclass
  ), false),
  'drive PDF descriptor staging table has RLS enabled'
);

select ok(
  to_regprocedure('public.stage_drive_pdf_reference_page_batch(uuid,jsonb)') is not null,
  'descriptor batch staging RPC exists'
);

select ok(
  coalesce((
    select prosecdef
      from pg_proc
     where oid = 'public.stage_drive_pdf_reference_page_batch(uuid,jsonb)'::regprocedure
  ), false),
  'descriptor batch staging RPC is security definer'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.stage_drive_pdf_reference_page_batch(uuid,jsonb)',
    'EXECUTE'
  ),
  'authenticated users may execute descriptor batch staging RPC'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.stage_drive_pdf_reference_page_batch(uuid,jsonb)',
    'EXECUTE'
  ),
  'anonymous users may not execute descriptor batch staging RPC'
);

select ok(
  has_table_privilege('authenticated', 'public.drive_pdf_reference_page_descriptors', 'SELECT'),
  'authenticated users may read their descriptor staging rows through RLS'
);

select ok(
  not has_table_privilege('authenticated', 'public.drive_pdf_reference_page_descriptors', 'INSERT'),
  'authenticated users may not insert descriptor staging rows directly'
);

select ok(
  to_regprocedure('public.finalize_staged_drive_pdf_reference_import(uuid,integer,integer)') is not null,
  'staged descriptor finalizer RPC exists'
);

select ok(
  coalesce((
    select prosecdef
      from pg_proc
     where oid = 'public.finalize_staged_drive_pdf_reference_import(uuid,integer,integer)'::regprocedure
  ), false),
  'staged descriptor finalizer RPC is security definer'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.finalize_staged_drive_pdf_reference_import(uuid,integer,integer)',
    'EXECUTE'
  ),
  'authenticated users may execute staged descriptor finalizer RPC'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.finalize_staged_drive_pdf_reference_import(uuid,integer,integer)',
    'EXECUTE'
  ),
  'anonymous users may not execute staged descriptor finalizer RPC'
);

select * from finish();
rollback;
