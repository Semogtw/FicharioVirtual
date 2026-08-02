create or replace function public.normalize_search_text(input_text text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select trim(
    regexp_replace(
      lower(
        extensions.unaccent(
          'extensions.unaccent'::regdictionary,
          coalesce(input_text, '')
        )
      ),
      '[[:space:]]+',
      ' ',
      'g'
    )
  );
$$;

create or replace function public.page_effective_text(page_row public.pages)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select coalesce(
    nullif(page_row.corrected_text, ''),
    nullif(page_row.native_text, ''),
    nullif(page_row.ocr_raw_text, ''),
    ''
  );
$$;

create or replace function public.refresh_page_search_fields()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.normalized_text := public.normalize_search_text(public.page_effective_text(new));
  new.search_vector := to_tsvector('simple', new.normalized_text);
  return new;
end;
$$;

create trigger pages_refresh_search_fields
before insert or update of native_text, ocr_raw_text, corrected_text
on public.pages
for each row execute function public.refresh_page_search_fields();

update public.pages
set native_text = native_text
where true;

create or replace function public.normalize_tag_name()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.name := trim(new.name);
  new.normalized_name := public.normalize_search_text(new.name);
  if new.normalized_name = '' then
    raise exception 'Tag name cannot be empty';
  end if;
  return new;
end;
$$;

create trigger tags_normalize_name
before insert or update of name
on public.tags
for each row execute function public.normalize_tag_name();

create index documents_title_trgm_idx
  on public.documents using gin (lower(title) extensions.gin_trgm_ops);
create index notebooks_name_trgm_idx
  on public.notebooks using gin (lower(name) extensions.gin_trgm_ops);

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
as $$
  with prepared_query as (
    select
      public.normalize_search_text(search_query) as normalized_query
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
      greatest(
        case when p.normalized_text = q.normalized_query then 2.0 else 0.0 end,
        case
          when p.normalized_text like '%' || q.normalized_query || '%' then 1.25
          else 0.0
        end,
        ts_rank_cd(p.search_vector, q.ts_query)::double precision,
        extensions.similarity(p.normalized_text, q.normalized_query),
        extensions.similarity(lower(d.title), q.normalized_query) * 0.8,
        extensions.similarity(lower(coalesce(n.name, '')), q.normalized_query) * 0.55
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
        or extensions.similarity(p.normalized_text, q.normalized_query) >= 0.22
        or lower(d.title) like '%' || q.normalized_query || '%'
        or extensions.similarity(lower(d.title), q.normalized_query) >= 0.3
        or lower(coalesce(n.name, '')) like '%' || q.normalized_query || '%'
      )
  )
  select
    ranked.page_id,
    ranked.document_id,
    ranked.document_title,
    ranked.notebook_id,
    ranked.notebook_name,
    ranked.page_number,
    left(ranked.effective_text, 360) as excerpt,
    ranked.calculated_rank as rank
  from ranked
  order by
    ranked.calculated_rank desc,
    ranked.document_title asc,
    ranked.page_number asc
  limit least(greatest(result_limit, 1), 100)
  offset greatest(result_offset, 0);
$$;

revoke execute on function public.normalize_search_text(text) from public, anon, authenticated;
revoke execute on function public.page_effective_text(public.pages) from public, anon, authenticated;
revoke execute on function public.refresh_page_search_fields() from public, anon, authenticated;
revoke execute on function public.normalize_tag_name() from public, anon, authenticated;

revoke execute on function public.search_pages(text, uuid, integer, integer) from public, anon;
grant execute on function public.search_pages(text, uuid, integer, integer) to authenticated;
