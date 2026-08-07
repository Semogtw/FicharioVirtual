begin;

create extension if not exists pgtap with schema extensions;
select plan(47);

select has_table('public', 'app_users', 'allowlist table exists');
select has_table('public', 'notebooks', 'notebooks table exists');
select has_table('public', 'documents', 'documents table exists');
select has_table('public', 'pages', 'pages table exists');
select has_table('public', 'ocr_jobs', 'OCR jobs table exists');
select has_table('public', 'usage_daily', 'daily usage table exists');
select has_table('public', 'tags', 'tags table exists');
select has_table('public', 'document_tags', 'document tags table exists');
select has_column('public', 'tags', 'updated_at', 'tags expose an update timestamp');
select ok(
  (
    select count(*) = 2
    from pg_constraint
    where conrelid = 'public.tags'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%120%'
  ),
  'tag names and normalized names allow the 120 character public contract'
);

select ok(
  (select relrowsecurity from pg_class where oid = 'public.app_users'::regclass),
  'RLS enabled on app_users'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.notebooks'::regclass),
  'RLS enabled on notebooks'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.documents'::regclass),
  'RLS enabled on documents'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.pages'::regclass),
  'RLS enabled on pages'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.ocr_jobs'::regclass),
  'RLS enabled on OCR jobs'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.tags'::regclass),
  'RLS enabled on tags'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.document_tags'::regclass),
  'RLS enabled on document tags'
);

select is(
  (select public from storage.buckets where id = 'documents'),
  false,
  'documents bucket is private'
);

select has_function('public', 'is_authorized_user', array[]::text[], 'authorization function exists');
select has_function('public', 'search_pages', array['text','uuid','integer','integer'], 'search function exists');
select has_function('public', 'claim_ocr_job', array['uuid','text','timestamp with time zone'], 'OCR claim function exists without an application quota argument');
select has_function('public', 'complete_ocr_job', array['uuid','text','jsonb','text','timestamp with time zone'], 'OCR completion function exists');
select has_function('public', 'fail_ocr_job', array['uuid','text','text','boolean','timestamp with time zone','timestamp with time zone'], 'OCR failure function exists');
select has_function('public', 'create_pdf_import', array['uuid','uuid','text','text','text','text','timestamp with time zone','jsonb','integer'], 'PDF import function exists');
select has_function('public', 'export_portable_manifest', array[]::text[], 'portable export function exists');
select has_function('public', 'get_usage_overview', array[]::text[], 'usage overview function exists');
select has_function('public', 'set_tag_membership', array['uuid','uuid','boolean'], 'tag membership function exists');
select has_function('public', 'recover_stale_ocr_jobs', array[]::text[], 'stale OCR recovery exists');
select has_function(
  'public',
  'list_resumable_ocr_pages',
  array['uuid','timestamp with time zone'],
  'retry-aware document OCR selection exists'
);

select ok(
  not has_function_privilege('anon', 'public.export_portable_manifest()', 'execute'),
  'anon cannot export portable data'
);
select ok(
  not has_function_privilege('anon', 'public.get_usage_overview()', 'execute'),
  'anon cannot inspect usage'
);
select ok(
  not has_function_privilege('anon', 'public.recover_stale_ocr_jobs()', 'execute'),
  'anon cannot recover OCR jobs'
);
select ok(
  not has_function_privilege('anon', 'public.set_tag_membership(uuid,uuid,boolean)', 'execute'),
  'anon cannot mutate tag membership'
);
select ok(
  has_function_privilege('authenticated', 'public.export_portable_manifest()', 'execute'),
  'authenticated role may call portable export under RLS'
);

select ok(
  not (select prosecdef from pg_proc where oid = 'public.is_authorized_user()'::regprocedure),
  'authorization helper runs with caller privileges'
);
select ok(
  not (select prosecdef from pg_proc where oid = 'public.clear_temporary_page_image(uuid,text)'::regprocedure),
  'temporary image cleanup relies on owner RLS instead of definer privileges'
);
select ok(
  not (
    select prosecdef
    from pg_proc
    where oid = 'public.complete_ocr_job(uuid,text,jsonb,text,timestamp with time zone)'::regprocedure
  ),
  'OCR completion relies on owner RLS instead of definer privileges'
);
select ok(
  not (
    select prosecdef
    from pg_proc
    where oid = 'public.fail_ocr_job(uuid,text,text,boolean,timestamp with time zone,timestamp with time zone)'::regprocedure
  ),
  'OCR failure relies on owner RLS instead of definer privileges'
);
select ok(
  (select prosecdef from pg_proc where oid = 'public.claim_ocr_job(uuid,text,timestamp with time zone)'::regprocedure),
  'OCR claim remains an explicit privileged quota capability'
);
select ok(
  (select prosecdef from pg_proc where oid = 'public.block_ocr_job_quota(uuid,text,timestamp with time zone)'::regprocedure),
  'quota blocking remains an explicit privileged accounting capability'
);
select ok(
  position(
    'is_authorized_user' in pg_get_functiondef('public.block_ocr_job_quota(uuid,text,timestamp with time zone)'::regprocedure)
  ) > 0,
  'privileged quota blocking checks the active-user allowlist'
);
select ok(
  (select prosecdef from pg_proc where oid = 'public.record_ocr_consent(integer)'::regprocedure),
  'OCR consent remains an explicit privileged allowlist capability'
);

select ok(
  not exists (
    select 1
    from pg_class as relation
    join pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relkind in ('r', 'p')
      and has_table_privilege('authenticated', relation.oid, 'TRUNCATE')
  ),
  'authenticated cannot truncate application tables'
);
select ok(
  not exists (
    select 1
    from pg_class as relation
    join pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relkind in ('r', 'p')
      and has_table_privilege('authenticated', relation.oid, 'TRIGGER')
  ),
  'authenticated cannot create triggers on application tables'
);
select ok(
  not exists (
    select 1
    from pg_class as relation
    join pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relkind in ('r', 'p')
      and has_table_privilege('authenticated', relation.oid, 'REFERENCES')
  ),
  'authenticated cannot create foreign keys against application tables'
);
select ok(
  not exists (
    select 1
    from pg_class as relation
    join pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relkind in ('r', 'p')
      and has_table_privilege('authenticated', relation.oid, 'MAINTAIN')
  ),
  'authenticated cannot run table maintenance operations'
);
select ok(
  not has_table_privilege('authenticated', 'public.usage_daily', 'INSERT')
    and not has_table_privilege('authenticated', 'public.usage_daily', 'UPDATE')
    and not has_table_privilege('authenticated', 'public.usage_daily', 'DELETE')
    and has_table_privilege('authenticated', 'public.usage_daily', 'SELECT'),
  'usage counters remain read-only to authenticated clients'
);

select * from finish();
rollback;
