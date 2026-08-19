begin;

create extension if not exists pgtap with schema extensions;
select plan(61);

select has_table('public', 'app_users', 'allowlist table exists');
select has_table('public', 'notebooks', 'notebooks table exists');
select has_table('public', 'documents', 'documents table exists');
select has_table('public', 'pages', 'pages table exists');
select has_table('public', 'ocr_jobs', 'OCR jobs table exists');
select has_table('public', 'usage_daily', 'daily usage table exists');
select has_table('public', 'tags', 'tags table exists');
select has_table('public', 'document_tags', 'document tags table exists');
select has_table('public', 'page_semantic_chunks', 'semantic chunk index exists');
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
select ok(
  (select relrowsecurity from pg_class where oid = 'public.page_semantic_chunks'::regclass),
  'RLS enabled on semantic chunks'
);

select is(
  (select public from storage.buckets where id = 'documents'),
  false,
  'documents bucket is private'
);

select has_function('public', 'is_authorized_user', array[]::text[], 'authorization function exists');
select has_function('public', 'search_pages', array['text','uuid','integer','integer'], 'search function exists');
select has_function('public', 'claim_ocr_job', array['uuid','text','timestamp with time zone'], 'OCR claim function exists without an application quota argument');
select has_function('public', 'complete_ocr_job', array['uuid','text','jsonb','public.page_status','timestamp with time zone'], 'OCR completion dependency exists');
select has_function('public', 'fail_ocr_job', array['uuid','text','text','boolean','timestamp with time zone','timestamp with time zone'], 'OCR failure function exists');
select ok(
  not exists (
    select 1 from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public' and procedure.proname = 'create_pdf_import'
  ),
  'pre-launch Supabase PDF import RPC is absent'
);
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
select has_function(
  'public',
  'search_pages_semantic',
  array['text','text','uuid','integer'],
  'semantic page search exists'
);
select has_function(
  'public',
  'replace_page_semantic_chunks',
  array['uuid','text','text','jsonb'],
  'semantic chunk replacement exists'
);
select ok(
  not exists (
    select 1 from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public' and procedure.proname = 'record_coverage_semantic_consent'
  ),
  'pre-launch coverage semantic consent RPC is absent'
);
select ok(
  not exists (
    select 1 from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public' and procedure.proname = 'create_image_import'
  ),
  'pre-launch Supabase image import RPC is absent'
);
select ok(
  not exists (
    select 1 from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public' and procedure.proname = 'create_image_import_v2'
  ),
  'pre-launch Supabase image v2 import RPC is absent'
);
select ok(
  not exists (
    select 1 from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public' and procedure.proname = 'create_drive_image_import'
  ),
  'pre-launch Drive image v1 import RPC is absent'
);
select ok(
  not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'app_users'
      and column_name in ('ocr_consent_at', 'ocr_consent_version')
  ),
  'pre-launch OCR consent columns are absent'
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
  not has_function_privilege('anon', 'public.search_pages_semantic(text,text,uuid,integer)', 'execute'),
  'anon cannot query semantic embeddings'
);
select ok(
  not has_function_privilege('anon', 'public.replace_page_semantic_chunks(uuid,text,text,jsonb)', 'execute'),
  'anon cannot mutate semantic embeddings'
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
  (
    select prosecdef
    from pg_proc
    where oid = 'public.complete_ocr_job(uuid,text,jsonb,public.page_status,timestamp with time zone)'::regprocedure
  ),
  'OCR completion dependency runs through an explicit security-definer boundary'
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
  not exists (
    select 1 from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public' and procedure.proname = 'record_ocr_consent'
  ),
  'pre-launch OCR consent function is absent'
);
select ok(
  not exists (
    select 1 from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public' and procedure.proname = 'record_search_semantic_consent'
  ),
  'pre-launch search semantic consent function is absent'
);
select ok(
  (select prosecdef from pg_proc where oid = 'public.replace_page_semantic_chunks(uuid,text,text,jsonb)'::regprocedure),
  'semantic chunk replacement uses a narrow privileged write boundary'
);
select ok(
  not has_table_privilege('authenticated', 'public.page_semantic_chunks', 'INSERT')
    and not has_table_privilege('authenticated', 'public.page_semantic_chunks', 'UPDATE')
    and not has_table_privilege('authenticated', 'public.page_semantic_chunks', 'DELETE')
    and has_table_privilege('authenticated', 'public.page_semantic_chunks', 'SELECT'),
  'semantic embeddings remain read-only to authenticated clients outside the validated RPC'
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