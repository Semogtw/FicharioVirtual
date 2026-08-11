-- Final pre-deploy hardening for resumable semantic indexing.
-- Failure records contain operational metadata only; no page text, prompts or embeddings.

create table public.semantic_index_failures (
  user_id uuid not null references auth.users(id) on delete cascade,
  page_id uuid not null references public.pages(id) on delete cascade,
  model text not null check (model ~ '^[A-Za-z0-9._-]{3,128}$'),
  failure_count integer not null default 1 check (failure_count between 1 and 12),
  last_status text not null check (last_status ~ '^[a-z0-9_]{1,32}$'),
  retry_after timestamptz not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, page_id, model)
);

alter table public.semantic_index_failures enable row level security;
revoke all on table public.semantic_index_failures from public, anon, authenticated;

create index semantic_index_failures_retry_idx
  on public.semantic_index_failures (user_id, model, retry_after);

create or replace function public.record_semantic_index_failure(
  target_page_id uuid,
  target_model text,
  failure_status text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner_id uuid;
  result_count integer;
begin
  if (select auth.uid()) is null or not (select public.is_authorized_user()) then
    raise exception 'Not authorized';
  end if;
  if target_model !~ '^[A-Za-z0-9._-]{3,128}$'
    or failure_status !~ '^[a-z0-9_]{1,32}$' then
    raise exception 'Invalid semantic index failure';
  end if;

  select p.user_id
  into owner_id
  from public.pages p
  where p.id = target_page_id
    and p.user_id = (select auth.uid());

  if owner_id is null then
    return 0;
  end if;

  insert into public.semantic_index_failures (
    user_id,
    page_id,
    model,
    failure_count,
    last_status,
    retry_after,
    updated_at
  ) values (
    owner_id,
    target_page_id,
    target_model,
    1,
    failure_status,
    now() + interval '60 seconds',
    now()
  )
  on conflict (user_id, page_id, model)
  do update set
    failure_count = least(public.semantic_index_failures.failure_count + 1, 12),
    last_status = excluded.last_status,
    retry_after = now() + make_interval(
      secs => least(
        86400,
        60 * power(2, least(public.semantic_index_failures.failure_count, 10))::integer
      )
    ),
    updated_at = now()
  returning failure_count into result_count;

  return result_count;
end;
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
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not (select public.is_authorized_user()) then
    raise exception 'Not authorized';
  end if;
  if target_model !~ '^[A-Za-z0-9._-]{3,128}$' then
    raise exception 'Invalid semantic model';
  end if;

  return query
  select
    p.id,
    d.id,
    d.title,
    p.page_number,
    left(public.page_effective_text(p), 24000),
    public.semantic_source_hash(public.page_effective_text(p))
  from public.pages p
  join public.documents d
    on d.id = p.document_id
    and d.user_id = p.user_id
  where p.user_id = (select auth.uid())
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
    and not exists (
      select 1
      from public.semantic_index_failures f
      where f.page_id = p.id
        and f.user_id = p.user_id
        and f.model = target_model
        and f.retry_after > now()
    )
  order by p.updated_at desc, p.id
  limit least(greatest(coalesce(result_limit, 16), 1), 64);
end;
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

  delete from public.semantic_index_failures
  where user_id = owner_id
    and page_id = target_page_id;

  return stored_count;
end;
$$;

create or replace function public.semantic_retrieval_stats(
  lookback_hours integer default 168
)
returns table (
  event_count bigint,
  semantic_only_results bigint,
  fallback_events bigint,
  average_duration_ms double precision,
  query_cache_hit_rate double precision
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not (select public.is_authorized_user()) then
    raise exception 'Not authorized';
  end if;

  return query
  select
    count(*)::bigint,
    coalesce(sum(e.semantic_only_count), 0)::bigint,
    count(*) filter (where e.mode = 'fallback')::bigint,
    coalesce(avg(e.duration_ms), 0)::double precision,
    coalesce(
      avg(case when e.query_embedding_cache_hit is null then null
               when e.query_embedding_cache_hit then 1.0 else 0.0 end),
      0
    )::double precision
  from public.semantic_retrieval_events e
  where e.user_id = (select auth.uid())
    and e.created_at >= now() - make_interval(
      hours => least(greatest(coalesce(lookback_hours, 168), 1), 2160)
    );
end;
$$;

revoke execute on function public.record_semantic_index_failure(uuid, text, text) from public, anon;
revoke execute on function public.list_pages_needing_semantic_index(text, uuid, integer) from public, anon;
revoke execute on function public.semantic_retrieval_stats(integer) from public, anon;

grant execute on function public.record_semantic_index_failure(uuid, text, text) to authenticated;
grant execute on function public.list_pages_needing_semantic_index(text, uuid, integer) to authenticated;
grant execute on function public.semantic_retrieval_stats(integer) to authenticated;
