begin;

select plan(21);

select ok(
  to_regclass('public.drive_pdf_reference_page_staging') is not null,
  'attempt-scoped Drive PDF descriptor staging table exists'
);

select ok(
  coalesce((
    select relrowsecurity
      from pg_class
     where oid = 'public.drive_pdf_reference_page_staging'::regclass
  ), false),
  'attempt-scoped descriptor staging table has RLS enabled'
);

select ok(
  not has_table_privilege('authenticated', 'public.drive_pdf_reference_page_staging', 'SELECT'),
  'authenticated users may not read attempt staging rows directly'
);

select ok(
  not has_table_privilege('authenticated', 'public.drive_pdf_reference_page_staging', 'INSERT'),
  'authenticated users may not insert attempt staging rows directly'
);

select ok(
  to_regprocedure('public.begin_drive_pdf_reference_descriptor_attempt(uuid,uuid,integer)') is not null,
  'descriptor lease begin RPC exists'
);

select ok(
  coalesce((
    select prosecdef
      from pg_proc
     where oid = 'public.begin_drive_pdf_reference_descriptor_attempt(uuid,uuid,integer)'::regprocedure
  ), false),
  'descriptor lease begin RPC is security definer'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.begin_drive_pdf_reference_descriptor_attempt(uuid,uuid,integer)',
    'EXECUTE'
  ),
  'authenticated users may begin descriptor leases'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.begin_drive_pdf_reference_descriptor_attempt(uuid,uuid,integer)',
    'EXECUTE'
  ),
  'anonymous users may not begin descriptor leases'
);

select ok(
  to_regprocedure('public.renew_drive_pdf_reference_descriptor_attempt(uuid,uuid)') is not null,
  'descriptor lease renew RPC exists'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.renew_drive_pdf_reference_descriptor_attempt(uuid,uuid)',
    'EXECUTE'
  ),
  'authenticated users may renew their descriptor lease'
);

select ok(
  to_regprocedure('public.stage_drive_pdf_reference_descriptor_batch(uuid,uuid,jsonb)') is not null,
  'attempt-scoped descriptor batch RPC exists'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.stage_drive_pdf_reference_descriptor_batch(uuid,uuid,jsonb)',
    'EXECUTE'
  ),
  'authenticated users may stage through the leased descriptor RPC'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.stage_drive_pdf_reference_descriptor_batch(uuid,uuid,jsonb)',
    'EXECUTE'
  ),
  'anonymous users may not stage leased descriptor batches'
);

select ok(
  to_regprocedure('public.finalize_drive_pdf_reference_descriptor_attempt(uuid,uuid,integer)') is not null,
  'leased descriptor finalizer RPC exists'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.finalize_drive_pdf_reference_descriptor_attempt(uuid,uuid,integer)',
    'EXECUTE'
  ),
  'authenticated users may publish through the leased descriptor finalizer'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.finalize_drive_pdf_reference_descriptor_attempt(uuid,uuid,integer)',
    'EXECUTE'
  ),
  'anonymous users may not publish leased descriptor attempts'
);

select ok(
  to_regprocedure('public.abandon_drive_pdf_reference_descriptor_attempt(uuid,uuid)') is not null,
  'descriptor lease abandon RPC exists'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.abandon_drive_pdf_reference_descriptor_attempt(uuid,uuid)',
    'EXECUTE'
  ),
  'authenticated users may abandon their matching descriptor lease'
);

select ok(
  to_regprocedure('public.finalize_drive_pdf_reference_import(uuid,jsonb,integer)') is null,
  'pre-launch direct Drive PDF finalizer is absent'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.stage_drive_pdf_reference_page_batch(uuid,jsonb)',
    'EXECUTE'
  ),
  'authenticated users cannot bypass the lease through legacy descriptor staging'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.finalize_staged_drive_pdf_reference_import(uuid,integer,integer)',
    'EXECUTE'
  ),
  'authenticated users cannot bypass the lease through the intermediate staged finalizer'
);

select * from finish();
rollback;
