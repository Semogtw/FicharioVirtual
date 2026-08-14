begin;

create extension if not exists pgtap with schema extensions;
select plan(19);

select has_table('public', 'page_visual_embeddings', 'visual page embedding table exists');
select has_table('public', 'page_visual_embedding_jobs', 'visual embedding queue exists');
select has_table('public', 'semantic_visual_events', 'visual semantic telemetry exists');

select ok(
  (select relrowsecurity and relforcerowsecurity
   from pg_class where oid = 'public.page_visual_embeddings'::regclass),
  'visual embeddings use forced RLS'
);
select ok(
  (select relrowsecurity and relforcerowsecurity
   from pg_class where oid = 'public.page_visual_embedding_jobs'::regclass),
  'visual jobs use forced RLS'
);
select ok(
  (select relrowsecurity and relforcerowsecurity
   from pg_class where oid = 'public.semantic_visual_events'::regclass),
  'visual telemetry uses forced RLS'
);

select has_function(
  'public', 'queue_page_visual_embedding_job',
  array['uuid','text','text','text','text','text'],
  'authenticated visual enqueue RPC exists'
);
select has_function(
  'public', 'claim_page_visual_embedding_jobs',
  array['text','integer'],
  'visual worker claim RPC exists'
);
select has_function(
  'public', 'complete_page_visual_embedding_job',
  array['uuid','text','text','bigint'],
  'visual worker completion RPC exists'
);
select has_function(
  'public', 'search_pages_visual_semantic',
  array['text','text','uuid','integer'],
  'cross-modal search RPC exists'
);
select has_function(
  'public', 'visual_embedding_stats',
  array['text'],
  'visual aggregate stats RPC exists'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.queue_page_visual_embedding_job(uuid,text,text,text,text,text)',
    'execute'
  ),
  'authenticated users can enqueue only their own eligible page through the RPC boundary'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.queue_page_visual_embedding_job_as_user(uuid,uuid,text,text,text,text,text)',
    'execute'
  ),
  'authenticated users cannot impersonate another owner when enqueueing'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.claim_page_visual_embedding_jobs(text,integer)',
    'execute'
  ),
  'authenticated clients cannot claim worker jobs'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.claim_page_visual_embedding_jobs(text,integer)',
    'execute'
  ),
  'service role can claim visual jobs'
);
select ok(
  has_function_privilege(
    'authenticated',
    'public.search_pages_visual_semantic(text,text,uuid,integer)',
    'execute'
  ),
  'authenticated users can search their visual index'
);
select ok(
  not has_table_privilege('authenticated', 'public.page_visual_embedding_jobs', 'SELECT')
    and not has_table_privilege('authenticated', 'public.semantic_visual_events', 'SELECT'),
  'visual operational metadata is not directly readable'
);
select ok(
  has_table_privilege('authenticated', 'public.page_visual_embeddings', 'SELECT')
    and not has_table_privilege('authenticated', 'public.page_visual_embeddings', 'INSERT')
    and not has_table_privilege('authenticated', 'public.page_visual_embeddings', 'UPDATE'),
  'visual vectors are readable only through owner RLS and not directly writable'
);
select ok(
  exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and tablename = 'page_visual_embeddings'
      and indexname = 'page_visual_embeddings_hnsw_idx'
      and indexdef ilike '%using hnsw%'
  ),
  'visual embeddings have an HNSW index'
);

select * from finish();
rollback;
