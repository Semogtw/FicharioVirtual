begin;

create extension if not exists pgtap with schema extensions;
select plan(17);

select has_table('public', 'semantic_query_embedding_cache', 'semantic query cache exists');
select has_table('public', 'semantic_retrieval_events', 'semantic retrieval telemetry exists');
select has_table('public', 'semantic_index_failures', 'semantic index retry state exists');

select ok(
  (select relrowsecurity from pg_class where oid = 'public.semantic_query_embedding_cache'::regclass),
  'RLS enabled on semantic query cache'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.semantic_retrieval_events'::regclass),
  'RLS enabled on semantic retrieval telemetry'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.semantic_index_failures'::regclass),
  'RLS enabled on semantic index retry state'
);

select ok(
  (select relforcerowsecurity from pg_class where oid = 'public.page_semantic_chunks'::regclass),
  'RLS forced on semantic page chunks'
);
select ok(
  (select relforcerowsecurity from pg_class where oid = 'public.semantic_query_embedding_cache'::regclass),
  'RLS forced on semantic query cache'
);
select ok(
  (select relforcerowsecurity from pg_class where oid = 'public.semantic_retrieval_events'::regclass),
  'RLS forced on semantic retrieval telemetry'
);
select ok(
  (select relforcerowsecurity from pg_class where oid = 'public.semantic_index_failures'::regclass),
  'RLS forced on semantic index retry state'
);

select has_function(
  'public',
  'record_semantic_index_failure',
  array['uuid','text','text'],
  'semantic failure quarantine RPC exists'
);
select has_function(
  'public',
  'semantic_retrieval_stats',
  array['integer'],
  'semantic retrieval aggregate RPC exists'
);
select has_function(
  'public',
  'get_cached_semantic_query_embedding',
  array['text','text'],
  'semantic query cache read RPC exists'
);

select ok(
  not has_function_privilege('anon', 'public.semantic_retrieval_stats(integer)', 'execute'),
  'anon cannot inspect semantic retrieval telemetry'
);
select ok(
  (select prosecdef from pg_proc where oid = 'public.semantic_retrieval_stats(integer)'::regprocedure),
  'semantic retrieval stats use an authorized security-definer boundary'
);
select ok(
  not has_table_privilege('authenticated', 'public.semantic_query_embedding_cache', 'SELECT')
    and not has_table_privilege('authenticated', 'public.semantic_retrieval_events', 'SELECT')
    and not has_table_privilege('authenticated', 'public.semantic_index_failures', 'SELECT'),
  'semantic operational metadata is not directly readable by authenticated clients'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.replace_page_semantic_chunks(uuid,text,text,jsonb)',
    'execute'
  )
    and not has_function_privilege(
      'authenticated',
      'public.replace_page_semantic_chunks(uuid,text,text,jsonb)',
      'execute'
    ),
  'semantic chunk replacement is background-only'
);

select * from finish();
rollback;
