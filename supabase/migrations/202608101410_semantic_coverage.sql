create extension if not exists vector with schema extensions;

create table public.page_semantic_chunks (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  page_id uuid not null references public.pages(id) on delete cascade,
  model text not null check (model ~ '^[A-Za-z0-9._-]{3,128}$'),
  source_hash text not null check (source_hash ~ '^[0-9a-f]{64}$'),
  chunk_index integer not null check (chunk_index >= 0 and chunk_index < 24),
  chunk_text text not null check (char_length(chunk_text) between 1 and 2400),
  embedding extensions.vector(768) not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (page_id, model, chunk_index)
);

create index page_semantic_chunks_owner_model_idx
  on public.page_semantic_chunks (user_id, model, page_id);
create index page_semantic_chunks_page_hash_idx
  on public.page_semantic_chunks (page_id, model, source_hash);

alter table public.page_semantic_chunks enable row level security;

create policy page_semantic_chunks_select_own
on public.page_semantic_chunks
for select
to authenticated
using (
  user_id = (select auth.uid())
  and (select public.is_authorized_user())
);

revoke all on table public.page_semantic_chunks from public, anon, authenticated;
grant select on table public.page_semantic_chunks to authenticated;

create or replace function public.semantic_source_hash(input_text text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select encode(extensions.digest(coalesce(input_text, ''), 'sha256'), 'hex');
$$;

create or replace function public.list_pages_needing_semantic_index(
  target_model text,
  notebook_filter uuid default null,
  result_limit integer default 16
)
returns table (
  page_id uuid,
  document_id uuid,
  document_title text,
  page_number integer,
  source_text text,
  source_hash text
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    p.id,
    d.id,
    d.title,
    p.page_number,
    public.page_effective_text(p),
    public.semantic_source_hash(public.page_effective_text(p))
  from public.pages p
  join public.documents d
    on d.id = p.document_id
    and d.user_id = p.user_id
  where p.user_id = (select auth.uid())
    and (select public.is_authorized_user())
    and target_model ~ '^[A-Za-z0-9._-]{3,128}$'
    and (notebook_filter is null or d.notebook_id = notebook_filter)
    and public.page_effective_text(p) <> ''
    and not exists (
      select 1
      from public.page_semantic_chunks c
      where c.page_id = p.id
        and c.user_id = p.user_id
        and c.model = target_model
        and c.source_hash = public.semantic_source_hash(public.page_effective_text(p))
    )
  order by p.updated_at desc, p.id
  limit least(greatest(coalesce(result_limit, 16), 1), 64);
$$;

create or replace function public.replace_page_semantic_chunks(
  target_page_id uuid,
  target_model text,
  target_source_hash text,
  chunk_payload jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner_id uuid;
  current_hash text;
  payload_count integer;
  stored_count integer;
begin
  if (select auth.uid()) is null or not (select public.is_authorized_user()) then
    raise exception 'Not authorized';
  end if;
  if target_model !~ '^[A-Za-z0-9._-]{3,128}$'
    or target_source_hash !~ '^[0-9a-f]{64}$'
    or jsonb_typeof(chunk_payload) <> 'array' then
    raise exception 'Invalid semantic chunk payload';
  end if;

  payload_count := jsonb_array_length(chunk_payload);
  if payload_count < 1 or payload_count > 24 then
    raise exception 'Invalid semantic chunk count';
  end if;

  select p.user_id, public.semantic_source_hash(public.page_effective_text(p))
  into owner_id, current_hash
  from public.pages p
  where p.id = target_page_id
    and p.user_id = (select auth.uid());

  if owner_id is null then
    raise exception 'Page not found';
  end if;
  if current_hash <> target_source_hash then
    return 0;
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(chunk_payload) as item(
      chunk_index integer,
      chunk_text text,
      embedding_text text
    )
    where item.chunk_index is null
      or item.chunk_index < 0
      or item.chunk_index >= 24
      or item.chunk_text is null
      or char_length(item.chunk_text) < 1
      or char_length(item.chunk_text) > 2400
      or item.embedding_text is null
      or char_length(item.embedding_text) > 24000
  ) then
    raise exception 'Invalid semantic chunk item';
  end if;

  if (
    select count(distinct item.chunk_index)
    from jsonb_to_recordset(chunk_payload) as item(chunk_index integer)
  ) <> payload_count then
    raise exception 'Duplicate semantic chunk index';
  end if;

  delete from public.page_semantic_chunks
  where page_id = target_page_id
    and model = target_model
    and user_id = owner_id;

  insert into public.page_semantic_chunks (
    user_id,
    page_id,
    model,
    source_hash,
    chunk_index,
    chunk_text,
    embedding,
    updated_at
  )
  select
    owner_id,
    target_page_id,
    target_model,
    target_source_hash,
    item.chunk_index,
    item.chunk_text,
    item.embedding_text::extensions.vector(768),
    now()
  from jsonb_to_recordset(chunk_payload) as item(
    chunk_index integer,
    chunk_text text,
    embedding_text text
  );

  get diagnostics stored_count = row_count;
  return stored_count;
end;
$$;

create or replace function public.semantic_index_stats(
  target_model text,
  notebook_filter uuid default null
)
returns table (
  total_pages bigint,
  indexed_pages bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with eligible as (
    select
      p.id,
      p.user_id,
      public.semantic_source_hash(public.page_effective_text(p)) as source_hash
    from public.pages p
    join public.documents d
      on d.id = p.document_id
      and d.user_id = p.user_id
    where p.user_id = (select auth.uid())
      and (select public.is_authorized_user())
      and target_model ~ '^[A-Za-z0-9._-]{3,128}$'
      and (notebook_filter is null or d.notebook_id = notebook_filter)
      and public.page_effective_text(p) <> ''
  )
  select
    count(*)::bigint,
    count(*) filter (
      where exists (
        select 1
        from public.page_semantic_chunks c
        where c.page_id = eligible.id
          and c.user_id = eligible.user_id
          and c.model = target_model
          and c.source_hash = eligible.source_hash
      )
    )::bigint
  from eligible;
$$;

create or replace function public.search_pages_semantic(
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
language sql
stable
security invoker
set search_path = ''
as $$
  with query_vector as (
    select query_embedding::extensions.vector(768) as value
  ),
  ranked as (
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
        least(
          1.0,
          1.0 - (c.embedding OPERATOR(extensions.<=>) q.value)
        )
      )::double precision as semantic_similarity,
      row_number() over (
        partition by c.page_id
        order by c.embedding OPERATOR(extensions.<=>) q.value asc, c.chunk_index asc
      ) as page_rank
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
      and (select public.is_authorized_user())
      and c.model = target_model
      and c.source_hash = public.semantic_source_hash(public.page_effective_text(p))
      and (notebook_filter is null or d.notebook_id = notebook_filter)
  )
  select
    ranked.page_id,
    ranked.document_id,
    ranked.document_title,
    ranked.notebook_id,
    ranked.notebook_name,
    ranked.page_number,
    ranked.excerpt,
    ranked.semantic_similarity
  from ranked
  where ranked.page_rank = 1
  order by ranked.semantic_similarity desc, ranked.document_title asc, ranked.page_number asc
  limit least(greatest(coalesce(result_limit, 12), 1), 50);
$$;

revoke execute on function public.semantic_source_hash(text) from public, anon, authenticated;
revoke execute on function public.list_pages_needing_semantic_index(text, uuid, integer) from public, anon;
revoke execute on function public.replace_page_semantic_chunks(uuid, text, text, jsonb) from public, anon;
revoke execute on function public.semantic_index_stats(text, uuid) from public, anon;
revoke execute on function public.search_pages_semantic(text, text, uuid, integer) from public, anon;

grant execute on function public.list_pages_needing_semantic_index(text, uuid, integer) to authenticated;
grant execute on function public.replace_page_semantic_chunks(uuid, text, text, jsonb) to authenticated;
grant execute on function public.semantic_index_stats(text, uuid) to authenticated;
grant execute on function public.search_pages_semantic(text, text, uuid, integer) to authenticated;
