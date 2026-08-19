-- Document-first search and hot-path indexes.
-- Search surfaces render one card per document, so deduplicate in PostgreSQL
-- before results cross the network instead of fetching repeated page matches.

create index if not exists documents_user_created_id_idx
  on public.documents (user_id, created_at desc, id desc);

create index if not exists documents_user_notebook_created_id_idx
  on public.documents (user_id, notebook_id, created_at desc, id desc)
  where notebook_id is not null;

create index if not exists documents_user_kind_created_id_idx
  on public.documents (user_id, kind, created_at desc, id desc);

create index if not exists documents_user_status_created_id_idx
  on public.documents (user_id, status, created_at desc, id desc);

create or replace function public.search_documents(
  search_query text,
  notebook_filter uuid default null,
  result_limit integer default 30,
  result_offset integer default 0
)
returns table (
  page_id uuid,
  document_id uuid,
  document_title text,
  notebook_id uuid,
  notebook_name text,
  page_number integer,
  excerpt text,
  rank double precision
)
language sql
stable
security invoker
set search_path = ''
as $$
  with prepared_query as (
    select public.normalize_search_text(search_query) as normalized_query
  ),
  query_terms as (
    select
      normalized_query,
      websearch_to_tsquery('simple', normalized_query) as ts_query
    from prepared_query
    where normalized_query <> ''
  ),
  ranked_pages as (
    select
      p.id as page_id,
      d.id as document_id,
      d.title as document_title,
      n.id as notebook_id,
      n.name as notebook_name,
      p.page_number,
      public.page_effective_text(p) as effective_text,
      q.normalized_query,
      greatest(
        case when p.normalized_text = q.normalized_query then 2.0 else 0.0 end,
        case
          when p.normalized_text like '%' || q.normalized_query || '%' then 1.50
          else 0.0
        end,
        ts_rank_cd(p.search_vector, q.ts_query)::double precision * 1.20,
        extensions.strict_word_similarity(q.normalized_query, p.normalized_text)::double precision * 1.25,
        extensions.word_similarity(q.normalized_query, p.normalized_text)::double precision * 1.15,
        extensions.similarity(p.normalized_text, q.normalized_query)::double precision * 0.45,
        extensions.strict_word_similarity(
          q.normalized_query,
          public.normalize_search_text(d.title)
        )::double precision * 0.95,
        extensions.word_similarity(
          q.normalized_query,
          public.normalize_search_text(d.title)
        )::double precision * 0.85,
        extensions.strict_word_similarity(
          q.normalized_query,
          public.normalize_search_text(coalesce(n.name, ''))
        )::double precision * 0.60
      ) as calculated_rank
    from public.pages p
    join public.documents d
      on d.id = p.document_id
      and d.user_id = p.user_id
    left join public.notebooks n
      on n.id = d.notebook_id
      and n.user_id = d.user_id
    cross join query_terms q
    where p.user_id = (select auth.uid())
      and (select public.is_authorized_user())
      and (notebook_filter is null or d.notebook_id = notebook_filter)
      and p.normalized_text <> ''
      and (
        p.search_vector @@ q.ts_query
        or p.normalized_text like '%' || q.normalized_query || '%'
        or extensions.word_similarity(q.normalized_query, p.normalized_text) >= 0.45
        or extensions.strict_word_similarity(q.normalized_query, p.normalized_text) >= 0.40
        or public.normalize_search_text(d.title) like '%' || q.normalized_query || '%'
        or extensions.word_similarity(
          q.normalized_query,
          public.normalize_search_text(d.title)
        ) >= 0.45
        or extensions.strict_word_similarity(
          q.normalized_query,
          public.normalize_search_text(d.title)
        ) >= 0.40
        or public.normalize_search_text(coalesce(n.name, '')) like '%' || q.normalized_query || '%'
        or extensions.strict_word_similarity(
          q.normalized_query,
          public.normalize_search_text(coalesce(n.name, ''))
        ) >= 0.40
      )
  ),
  best_page_per_document as (
    select
      ranked_pages.*,
      row_number() over (
        partition by ranked_pages.document_id
        order by
          ranked_pages.calculated_rank desc,
          ranked_pages.page_number asc,
          ranked_pages.page_id asc
      ) as document_rank
    from ranked_pages
  ),
  selected as (
    select *
    from best_page_per_document
    where document_rank = 1
    order by calculated_rank desc, document_title asc, document_id asc
    limit least(greatest(result_limit, 1), 100)
    offset greatest(result_offset, 0)
  )
  select
    selected.page_id,
    selected.document_id,
    selected.document_title,
    selected.notebook_id,
    selected.notebook_name,
    selected.page_number,
    public.search_excerpt(selected.effective_text, selected.normalized_query, 360) as excerpt,
    selected.calculated_rank as rank
  from selected
  order by selected.calculated_rank desc, selected.document_title asc, selected.document_id asc;
$$;

create or replace function public.search_documents_semantic(
  query_embedding text,
  target_model text,
  notebook_filter uuid default null,
  result_limit integer default 12
)
returns table (
  page_id uuid,
  document_id uuid,
  document_title text,
  notebook_id uuid,
  notebook_name text,
  page_number integer,
  excerpt text,
  semantic_similarity double precision
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not (select public.is_authorized_user()) then
    raise exception using errcode = '42501', message = 'Not authorized';
  end if;
  if target_model !~ '^[A-Za-z0-9._-]{3,128}$'
    or query_embedding is null
    or char_length(query_embedding) > 24000
    or result_limit is null
    or result_limit < 1
    or result_limit > 100 then
    raise exception using errcode = '22023', message = 'Invalid semantic document search';
  end if;

  perform set_config('hnsw.ef_search', '80', true);

  return query
  with query_vector as (
    select query_embedding::extensions.vector(768) as value
  ),
  nearest_chunks as (
    select
      c.page_id,
      d.id as document_id,
      d.title as document_title,
      n.id as notebook_id,
      n.name as notebook_name,
      p.page_number,
      c.chunk_text as excerpt,
      greatest(
        0.0,
        least(1.0, 1.0 - (c.embedding OPERATOR(extensions.<=>) q.value))
      )::double precision as semantic_similarity,
      c.embedding OPERATOR(extensions.<=>) q.value as distance,
      c.chunk_index
    from public.page_semantic_chunks c
    join public.pages p
      on p.id = c.page_id
      and p.user_id = c.user_id
    join public.documents d
      on d.id = p.document_id
      and d.user_id = p.user_id
    left join public.notebooks n
      on n.id = d.notebook_id
      and n.user_id = d.user_id
    cross join query_vector q
    where c.user_id = (select auth.uid())
      and c.model = target_model
      and c.source_hash = public.semantic_source_hash(public.page_effective_text(p))
      and (notebook_filter is null or d.notebook_id = notebook_filter)
    order by c.embedding OPERATOR(extensions.<=>) q.value asc, c.page_id asc, c.chunk_index asc
    limit least(greatest(result_limit * 8, 80), 800)
  ),
  best_per_document as (
    select
      nearest_chunks.*,
      row_number() over (
        partition by nearest_chunks.document_id
        order by nearest_chunks.distance asc, nearest_chunks.page_number asc, nearest_chunks.chunk_index asc
      ) as document_rank
    from nearest_chunks
  )
  select
    best_per_document.page_id,
    best_per_document.document_id,
    best_per_document.document_title,
    best_per_document.notebook_id,
    best_per_document.notebook_name,
    best_per_document.page_number,
    best_per_document.excerpt,
    best_per_document.semantic_similarity
  from best_per_document
  where best_per_document.document_rank = 1
  order by
    best_per_document.semantic_similarity desc,
    best_per_document.document_title asc,
    best_per_document.document_id asc
  limit result_limit;
end;
$$;

create or replace function public.search_documents_visual_semantic(
  query_embedding text,
  target_model text,
  notebook_filter uuid default null,
  result_limit integer default 12
)
returns table (
  page_id uuid,
  document_id uuid,
  document_title text,
  notebook_id uuid,
  notebook_name text,
  page_number integer,
  visual_similarity double precision
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not (select public.is_authorized_user()) then
    raise exception using errcode = '42501', message = 'Not authorized';
  end if;
  if target_model !~ '^[A-Za-z0-9._-]{3,128}$'
    or query_embedding is null
    or char_length(query_embedding) > 24000
    or result_limit is null
    or result_limit < 1
    or result_limit > 100 then
    raise exception using errcode = '22023', message = 'Invalid visual document search';
  end if;

  perform set_config('hnsw.ef_search', '80', true);

  return query
  with query_vector as (
    select query_embedding::extensions.vector(768) as value
  ),
  nearest_pages as (
    select
      e.page_id,
      d.id as document_id,
      d.title as document_title,
      n.id as notebook_id,
      n.name as notebook_name,
      p.page_number,
      greatest(
        0.0,
        least(1.0, 1.0 - (e.embedding OPERATOR(extensions.<=>) q.value))
      )::double precision as visual_similarity,
      e.embedding OPERATOR(extensions.<=>) q.value as distance
    from public.page_visual_embeddings e
    join public.pages p
      on p.id = e.page_id
      and p.user_id = e.user_id
    join public.documents d
      on d.id = p.document_id
      and d.user_id = p.user_id
    left join public.notebooks n
      on n.id = d.notebook_id
      and n.user_id = d.user_id
    cross join query_vector q
    where e.user_id = (select auth.uid())
      and e.model = target_model
      and (notebook_filter is null or d.notebook_id = notebook_filter)
    order by e.embedding OPERATOR(extensions.<=>) q.value asc, d.id asc, p.page_number asc
    limit least(greatest(result_limit * 6, 60), 600)
  ),
  best_per_document as (
    select
      nearest_pages.*,
      row_number() over (
        partition by nearest_pages.document_id
        order by nearest_pages.distance asc, nearest_pages.page_number asc, nearest_pages.page_id asc
      ) as document_rank
    from nearest_pages
  )
  select
    best_per_document.page_id,
    best_per_document.document_id,
    best_per_document.document_title,
    best_per_document.notebook_id,
    best_per_document.notebook_name,
    best_per_document.page_number,
    best_per_document.visual_similarity
  from best_per_document
  where best_per_document.document_rank = 1
  order by
    best_per_document.visual_similarity desc,
    best_per_document.document_title asc,
    best_per_document.document_id asc
  limit result_limit;
end;
$$;

revoke execute on function public.search_documents(text, uuid, integer, integer)
  from public, anon;
revoke execute on function public.search_documents_semantic(text, text, uuid, integer)
  from public, anon;
revoke execute on function public.search_documents_visual_semantic(text, text, uuid, integer)
  from public, anon;

grant execute on function public.search_documents(text, uuid, integer, integer)
  to authenticated;
grant execute on function public.search_documents_semantic(text, text, uuid, integer)
  to authenticated;
grant execute on function public.search_documents_visual_semantic(text, text, uuid, integer)
  to authenticated;
