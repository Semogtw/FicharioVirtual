begin;

create extension if not exists pgtap with schema extensions;
select plan(10);

select has_function(
  'public',
  'list_background_semantic_users',
  array['text', 'integer'],
  'background semantic user selection RPC exists'
);
select has_function(
  'public',
  'background_semantic_as_user',
  array['uuid', 'text', 'jsonb'],
  'background semantic impersonation RPC exists'
);
select has_function(
  'public',
  'claim_page_visual_embedding_jobs',
  array['text', 'integer'],
  'visual claim RPC exists'
);

insert into auth.users (id, email)
values
  ('c1111111-1111-4111-8111-111111111111', 'embedding-owner@example.test'),
  ('c2222222-2222-4222-8222-222222222222', 'embedding-public@example.test');

insert into public.app_users (user_id, is_active, provider_profile)
values
  ('c1111111-1111-4111-8111-111111111111', true, 'owner'),
  ('c2222222-2222-4222-8222-222222222222', true, 'public');

insert into public.documents (
  id, user_id, title, kind, original_filename, storage_path, page_count, status
) values
  (
    'c3333333-3333-4333-8333-333333333333',
    'c1111111-1111-4111-8111-111111111111',
    'Owner embedding page',
    'image',
    'owner.png',
    'c1111111-1111-4111-8111-111111111111/owner.png',
    1,
    'ready'
  ),
  (
    'c4444444-4444-4444-8444-444444444444',
    'c2222222-2222-4222-8222-222222222222',
    'Public embedding page',
    'image',
    'public.png',
    'c2222222-2222-4222-8222-222222222222/public.png',
    1,
    'ready'
  );

insert into public.pages (
  id, user_id, document_id, page_number, native_text, normalized_text, status
) values
  (
    'c5555555-5555-4555-8555-555555555551',
    'c1111111-1111-4111-8111-111111111111',
    'c3333333-3333-4333-8333-333333333333',
    1,
    'Owner text for indexing',
    'Owner text for indexing',
    'ready'
  ),
  (
    'c5555555-5555-4555-8555-555555555552',
    'c2222222-2222-4222-8222-222222222222',
    'c4444444-4444-4444-8444-444444444444',
    1,
    'Public text must stay lexical',
    'Public text must stay lexical',
    'ready'
  );

select is(
  (select count(*)::integer
     from public.list_background_semantic_users('gemini-embedding-2', 64)),
  1,
  'background semantic user selection returns only owner profiles'
);
select is(
  public.background_semantic_as_user(
    'c2222222-2222-4222-8222-222222222222'::uuid,
    'list',
    '{"model":"gemini-embedding-2","limit":1}'::jsonb
  )->>'code',
  'user_unavailable',
  'public profiles cannot enter the semantic Gemini impersonation boundary'
);
select is(
  public.background_semantic_as_user(
    'c1111111-1111-4111-8111-111111111111'::uuid,
    'list',
    '{"model":"gemini-embedding-2","limit":1}'::jsonb
  )->>'ok',
  'true',
  'owner profiles remain eligible for background semantic indexing'
);

select throws_ok(
  $$
    insert into public.page_visual_embedding_jobs (
      user_id, page_id, document_id, model, document_kind, media_path,
      mime_type, routing_version, routing_reason
    ) values (
      'c2222222-2222-4222-8222-222222222222'::uuid,
      'c5555555-5555-4555-8555-555555555552'::uuid,
      'c4444444-4444-4444-8444-444444444444'::uuid,
      'gemini-embedding-2', 'image',
      'c2222222-2222-4222-8222-222222222222/public.png',
      'image/png', 'visual-v1', 'ocr_completion'
    )
  $$,
  '42501',
  'Public accounts cannot use Gemini visual embeddings',
  'public visual jobs are rejected at the database write boundary'
);

select lives_ok(
  $$
    insert into public.page_visual_embedding_jobs (
      user_id, page_id, document_id, model, document_kind, media_path,
      mime_type, routing_version, routing_reason
    ) values (
      'c1111111-1111-4111-8111-111111111111'::uuid,
      'c5555555-5555-4555-8555-555555555551'::uuid,
      'c3333333-3333-4333-8333-333333333333'::uuid,
      'gemini-embedding-2', 'image',
      'c1111111-1111-4111-8111-111111111111/owner.png',
      'image/png', 'visual-v1', 'ocr_completion'
    )
  $$,
  'owner visual jobs remain queueable'
);
select is(
  (select count(*)::integer
     from public.claim_page_visual_embedding_jobs('gemini-embedding-2', 6)),
  1,
  'visual worker claim returns owner jobs only'
);
select is(
  (select status from public.page_visual_embedding_jobs
    where user_id = 'c1111111-1111-4111-8111-111111111111'::uuid),
  'processing',
  'owner visual job claim enters processing'
);

select * from finish();
rollback;
