create or replace function public.search_excerpt(
  input_text text,
  search_query text,
  excerpt_length integer default 360
)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  with parameters as (
    select
      coalesce(input_text, '') as source_text,
      public.normalize_search_text(search_query) as normalized_query,
      least(greatest(coalesce(excerpt_length, 360), 80), 1000) as target_length
  ),
  query_terms as (
    select distinct term
    from parameters p,
      regexp_split_to_table(p.normalized_query, '[^[:alnum:]_-]+') as terms(term)
    where char_length(term) >= 2
  ),
  source_words as (
    select matches.word
    from parameters p,
      lateral (
        select match[1] as word
        from regexp_matches(
          p.source_text,
          '([[:alnum:]_]+(?:[’''-][[:alnum:]_]+)*)',
          'g'
        ) as match
      ) as matches
    where matches.word <> ''
  ),
  best_word as (
    select
      sw.word,
      max(
        extensions.similarity(
          public.normalize_search_text(sw.word),
          qt.term
        )
      ) as score
    from source_words sw
    cross join query_terms qt
    group by sw.word
    order by score desc, char_length(sw.word) desc
    limit 1
  ),
  located as (
    select
      p.source_text,
      p.target_length,
      char_length(p.source_text) as source_length,
      coalesce(nullif(position(bw.word in p.source_text), 0), 1) as match_start,
      coalesce(char_length(bw.word), 0) as match_length
    from parameters p
    left join best_word bw on true
  ),
  windowed as (
    select
      source_text,
      target_length,
      source_length,
      greatest(
        1,
        least(
          greatest(1, source_length - target_length + 1),
          match_start - greatest(0, (target_length - match_length) / 2)
        )
      ) as excerpt_start
    from located
  )
  select case
    when source_text = '' then ''
    when source_length <= target_length then source_text
    else
      (case when excerpt_start > 1 then '…' else '' end)
      || trim(substr(source_text, excerpt_start, target_length))
      || (case
        when excerpt_start + target_length - 1 < source_length then '…'
        else ''
      end)
  end
  from windowed;
$$;

create index if not exists documents_title_normalized_trgm_idx
  on public.documents using gin (
    (public.normalize_search_text(title)) extensions.gin_trgm_ops
  );

create index if not exists notebooks_name_normalized_trgm_idx
  on public.notebooks using gin (
    (public.normalize_search_text(name)) extensions.gin_trgm_ops
  );

create or replace function public.search_pages(
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
set pg_trgm.word_similarity_threshold = 0.45
set pg_trgm.strict_word_similarity_threshold = 0.40
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
  ranked as (
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
        or q.normalized_query OPERATOR(extensions.<%) p.normalized_text
        or q.normalized_query OPERATOR(extensions.<<%) p.normalized_text
        or public.normalize_search_text(d.title) like '%' || q.normalized_query || '%'
        or q.normalized_query OPERATOR(extensions.<%) public.normalize_search_text(d.title)
        or q.normalized_query OPERATOR(extensions.<<%) public.normalize_search_text(d.title)
        or public.normalize_search_text(coalesce(n.name, '')) like '%' || q.normalized_query || '%'
        or q.normalized_query OPERATOR(extensions.<<%) public.normalize_search_text(coalesce(n.name, ''))
      )
  ),
  selected as (
    select *
    from ranked
    order by
      calculated_rank desc,
      document_title asc,
      page_number asc
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
    public.search_excerpt(
      selected.effective_text,
      selected.normalized_query,
      360
    ) as excerpt,
    selected.calculated_rank as rank
  from selected
  order by
    selected.calculated_rank desc,
    selected.document_title asc,
    selected.page_number asc;
$$;

revoke execute on function public.search_excerpt(text, text, integer)
  from public, anon, authenticated;
revoke execute on function public.search_pages(text, uuid, integer, integer)
  from public, anon;
grant execute on function public.search_pages(text, uuid, integer, integer)
  to authenticated;
